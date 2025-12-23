import math

import matplotlib.patches as patches
import matplotlib.pyplot as plt
import torch
from fastai.vision.all import *  # noqa: F403  # pyright: ignore[reportAssignmentType]
from fastai.vision.all import (
    ClassificationInterpretation,
    CrossEntropyLossFlat,
    CSVLogger,
    DataLoaders,
    error_rate,
    vision_learner,
)

from .. import R49DataLoaders, R49Dataset
from ..data.image_transform import apply_scaling_transform
from .config import LearnerConfig

VALID_PCT = 0.25


class Learner(LearnerConfig):
    def __init__(self, model_name: str, dls: DataLoaders | None = None):
        super().__init__(model_name)

        # Dataset
        ds = R49Dataset(
            self.data_dir.rglob("**/*.r49"),
            dpt=self.dpt,
            size=int(1.5 * self.size),
            labels=self.labels,
            image_transform=apply_scaling_transform,
        )
        self._dataset = ds  # Save dataset for lookup in show_results
        self._dls = R49DataLoaders.from_dataset(
            ds,
            valid_pct=VALID_PCT,
            crop_size=self.size,
            bs=self.batch_size,
            vocab=self.labels,
        )

        # Create learner
        arch = self.get_architecture(self.arch_name)
        self._learn_obj = vision_learner(
            self._dls, arch, metrics=error_rate, loss_func=CrossEntropyLossFlat()
        )

        if self._dls.vocab != self.labels:
            raise ValueError(f"Vocab mismatch: {self._dls.vocab} != {self.labels}")

        # Load existing model if available
        model_path = self.model_dir / "model.pth"
        if model_path.exists():
            print(f"Loading weights from {model_path}")
            try:
                saved_model = torch.load(
                    model_path, map_location=self._dls.device, weights_only=False
                )
                if isinstance(saved_model, torch.nn.Module):
                    self._learn_obj.model = saved_model
                else:
                    self._learn_obj.model.load_state_dict(saved_model)
            except Exception as e:
                print(f"Warning: Failed to load saved model parameters: {e}")

    # TODO: catch keyboard interrupt and save model
    def learn(self, epochs: int = 20):
        # Setup CSV Logger
        csv_logger = CSVLogger(fname=str(self.model_dir / "stats.csv"), append=True)

        try:
            # Fine tune
            self._learn_obj.fine_tune(epochs, cbs=[csv_logger])
        except KeyboardInterrupt:
            print("\nTraining interrupted by user. Saving current state...")
        finally:
            # Save result to .pth file
            model_path = self.model_dir / "model.pth"
            print(f"Saving model to {model_path}")
            torch.save(self._learn_obj.model, model_path)

    def show_results(self, N=12, ds_idx=1):
        """
        Show results for training (ds_idx=0) or validation (ds_idx=1) set.
        """
        # Interpretation object uses validation set by default (ds_idx=1)
        interp = ClassificationInterpretation.from_learner(
            self._learn_obj, ds_idx=ds_idx
        )
        interp.plot_confusion_matrix()

        # Custom top losses with metadata
        # Get predictions, targets, and losses for the specified dataset index
        # We disable augmentation here to see the actual samples clearly
        dl = self._dls[ds_idx].new(shuffled=False, drop_last=False)
        # Note: Rotate(split_idx=0) will still apply to train if we don't handle it,
        # but FastAI dataloaders usually handle the context correctly.
        preds, targs, losses = self._learn_obj.get_preds(dl=dl, with_loss=True)

        # Get top losses (indices)
        top_losses, idxs = losses.topk(min(N, len(losses)))

        # Get items from the dataloader (indices into original dataset)
        items = dl.items

        cols = math.ceil(math.sqrt(N))
        rows = math.ceil(N / cols)
        # figsize is in inches, so we allocate 3 inches per subplot for better visibility
        fig, axes = plt.subplots(rows, cols, figsize=(3 * cols, 3 * rows))
        ds_name = "Validation" if ds_idx == 1 else "Training"
        fig.suptitle(f"Top Losses / Misclassified in {ds_name} Set", fontsize=16)

        for i in range(rows * cols):
            if rows * cols > 1:
                ax = axes.flat[i]
            else:
                ax = axes
            if i >= N:
                ax.axis("off")
                continue

            idx = idxs[i]
            # items[idx] is index in R49Dataset
            original_idx = items[idx]

            # Get info from dataset
            # filename is the r49 file, img_idx is index in that file, _uuid is the marker
            filename, img_idx, _uuid = self._dataset.get_info(original_idx)

            # Use pre-computed predictions
            pred_idx = preds[idx].argmax().item()
            pred_label = self._dls.vocab[pred_idx]
            true_label = self._dls.vocab[targs[idx]]

            # Retrieve original image (PIL Image)
            original_img, _ = self._dataset[original_idx]

            loss = top_losses[i].item()  # Loss from topk

            # Show original image
            ax.imshow(original_img)

            # Show title caption
            color = "green" if true_label == pred_label else "red"
            title = f"{filename} #{img_idx}\nTrue: {true_label} / Pred: {pred_label}\nLoss: {loss:.2f}"
            ax.set_title(title, fontsize=9, color=color)

            # Add centered crop box
            W, H = original_img.size
            S = self.size
            x0 = (W - S) / 2
            y0 = (H - S) / 2
            rect = patches.Rectangle(
                (x0, y0), S, S, linewidth=2, edgecolor=color, facecolor="none"
            )
            ax.add_patch(rect)

        plt.tight_layout()
        plt.show()
