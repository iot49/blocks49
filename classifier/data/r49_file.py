import json
import zipfile
from pathlib import Path
from typing import Callable, override

import cv2
import numpy as np
import torch
from cv2.typing import MatLike
from PIL import Image

from .manifest import Manifest


class B49File(torch.utils.data.Dataset[tuple[Image.Image, str]]):
    def __init__(
        self,
        r49file: Path,
        *,
        dpt: int,
        size: int,
        labels: list[str],
        image_transform: Callable[[MatLike, Manifest, int], tuple[MatLike, MatLike]],
        verbose: bool = False,
    ):
        self._r49file: Path = r49file
        self._labels: list[str] = labels
        self._size: int = size
        self._dpt: int = dpt
        self._image_transform: Callable[
            [MatLike, Manifest, int], tuple[MatLike, MatLike]
        ] = image_transform
        self._verbose: bool = verbose
        self._manifest: Manifest
        self._x: list[MatLike] = []
        self._y: list[str] = []
        self._source_info: list[tuple[str, int, str]] = []

        self._read_r49()
        self._create_xy()

    def get_info(self, idx: int) -> tuple[str, int, str]:
        """Return (r49_filename, image_index, label_id) for the given index."""
        return self._source_info[idx]

    @property
    def manifest(self):
        return self._manifest

    def __len__(self):
        return len(self._x)

    @override
    def __getitem__(self, idx: int):
        img_mat = self._x[idx]
        # Match FastAI's ToTensor: BGR->RGB, HWC->CHW, 0-255->0-1 float
        # But return PIL Image, so FastAI can handle the rest
        img_cv2_rgb: MatLike = cv2.cvtColor(img_mat, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_cv2_rgb)
        return pil_img, self._y[idx]

    def save(self, output_path: Path):
        """Save the dataset samples to the specified output path."""
        for i, (img, label) in enumerate(zip(self._x, self._y)):
            label_dir = output_path / label
            label_dir.mkdir(parents=True, exist_ok=True)
            im_file = label_dir / f"{label}.{self._r49file.stem}_{i}.jpg"
            _ = cv2.imwrite(str(im_file), img)

    def _read_r49(self):
        with zipfile.ZipFile(self._r49file, "r") as zf:
            with zf.open("manifest.json") as manifest_file:
                self._manifest = Manifest(**(json.load(manifest_file)))  # pyright: ignore[reportAny]
                assert self._manifest.version == 2, (
                    f"Got manifest unsupported version {self._manifest.version}. Expected version 2."
                )

    def _create_xy(self):
        size = self._size

        # Relabel train-coupler and train-end to train if not classifier target
        label_map = {label: label for label in self._labels}
        if "train" in self._labels and "train-coupler" not in self._labels:
            label_map["train-coupler"] = "train"
        if "train" in self._labels and "train-end" not in self._labels:
            pass
            # challenging, shows too much track
            # label_map["train-end"] = "train"

        with zipfile.ZipFile(self._r49file, "r") as zf:
            for i in range(self._manifest.number_of_images):
                image_meta = self._manifest.get_image(i)
                filename = image_meta.filename

                # Read image bytes from zip
                try:
                    with zf.open(filename) as img_file:
                        image_bytes = img_file.read()
                except KeyError:
                    # Try finding the file if exact match fails (e.g. ./ prefix issues)
                    # or just raise
                    raise ValueError(
                        f"Image file {filename} not found in {self._r49file}"
                    )

                # Convert bytes to numpy array and decode with OpenCV
                nparr = np.frombuffer(image_bytes, np.uint8)
                image_cv2 = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if image_cv2 is None:
                    raise ValueError(
                        f"Failed to decode image {filename} from {self._r49file}"
                    )

                # Apply perspective transform to entire image
                transformed_image, transform_matrix = self._image_transform(
                    image_cv2,
                    self._manifest,
                    self._dpt,
                )

                for label_id, marker in image_meta.labels.items():
                    # Use marker type as label
                    label_name = label_map.get(marker.type, marker.type)
                    if label_name not in self._labels:
                        continue

                    if transform_matrix is not None:
                        marker_point = np.array(
                            [[[marker.x, marker.y]]], dtype=np.float32
                        )
                        cx_cy = cv2.perspectiveTransform(marker_point, transform_matrix)
                        if cx_cy is None:
                            raise ValueError(f"Failed to transform marker {label_id}")
                        cx, cy = cx_cy[0, 0]
                    else:
                        cx, cy = marker.x, marker.y

                    cx_float = float(cx)  # pyright: ignore[reportAny]
                    cy_float = float(cy)  # pyright: ignore[reportAny]

                    cx = int(cx_float)
                    cy = int(cy_float)

                    try:
                        # Check bounds
                        crop_radius = size // 2
                        if (
                            cy - crop_radius < 0
                            or cy + crop_radius > transformed_image.shape[0]  # pyright: ignore[reportAny]
                            or cx - crop_radius < 0
                            or cx + crop_radius > transformed_image.shape[1]
                        ):  # pyright: ignore[reportAny]
                            if self._verbose:
                                print(
                                    f"Skipping {label_id} in {filename}: out of bounds."
                                )
                            continue

                        cropped_image = transformed_image[
                            cy - crop_radius : cy + crop_radius,
                            cx - crop_radius : cx + crop_radius,
                        ]

                        self._x.append(cropped_image)
                        self._y.append(label_name)
                        # Store auxilliary info to identify misclassifications
                        self._source_info.append((self._r49file.name, i, label_id))

                    except Exception:
                        if self._verbose:
                            print(
                                f"Skipping {label_id} in {filename}: error during crop."
                            )
                        pass

    @override
    def __str__(self):
        return f"B49FileDataset(Path('{self._r49file}'))"
