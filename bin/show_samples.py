#!/usr/bin/env python3

import argparse

import matplotlib.pyplot as plt
from fastai.data.all import set_seed

from classifier import LearnerConfig as Config
from classifier import R49DataLoaders, R49Dataset, apply_scaling_transform

"""
Show random samples from R49Dataset.
"""


def show_samples():
    parser = argparse.ArgumentParser(description="Show random samples from R49Dataset")
    parser.add_argument(
        "model", nargs="?", default="resnet18", help="Model name (to load config)"
    )
    parser.add_argument(
        "--no-aug", action="store_true", help="Disable data augmentation"
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    if args.seed is not None:
        set_seed(args.seed, reproducible=True)

    # Load config to get defaults
    try:
        config_obj = Config(args.model)
        data_dir = config_obj.data_dir
        labels = config_obj.labels
        size = config_obj.size
        dpt = config_obj.dpt
    except Exception as e:
        print(f"Error loading config: {e}")
        return

    files = list(data_dir.rglob("**/*.r49"))
    if not files:
        print("No .r49 files found.")
        return

    ds = R49Dataset(
        files,
        dpt=dpt,
        size=size,
        labels=labels,
        image_transform=apply_scaling_transform,
    )
    print(f"Model: {args.model}, Dataset size: {len(ds)}, Augmentation: {args.no_aug}")

    if len(ds) == 0:
        return

    COLS = 4
    ROWS = 3

    # Create dataloaders
    print("Creating R49DataLoaders...")
    dls = R49DataLoaders.from_dataset(
        ds,
        valid_pct=0,
        crop_size=size,
        bs=COLS * ROWS,
        vocab=labels,
        data_augmentation=args.no_aug,
    )
    # R49DataLoaders applies CropPad in item_tfms and Rotate in batch_tfms.
    # We want to iterate batches from the training loader to see final tensors.

    # Iterator for batches
    dl_iter = iter(dls.train)
    current_batch = None

    fig = plt.figure(figsize=(COLS * 3, ROWS * 3))

    def get_next_batch():
        nonlocal dl_iter
        try:
            return next(dl_iter)
        except StopIteration:
            # Restart iterator
            dl_iter = iter(dls.train)
            return next(dl_iter)

    def draw_page():
        nonlocal current_batch
        fig.clear()

        if current_batch is None:
            current_batch = get_next_batch()

        x, y = current_batch
        # x is TensorImage (B, C, H, W)
        # y is TensorCategory (B)

        batch_size = x.shape[0]

        for i in range(batch_size):
            if i >= COLS * ROWS:
                break

            # Convert tensor to image for display
            # FastAI TensorImage is already close, but we need to permute for matplotlib (C,H,W -> H,W,C)
            img_tensor = x[i].cpu().permute(1, 2, 0)

            # Denormalize if normalized? R49DataLoaders didn't add Normalize callback explicitely
            # but usually it's good to check.
            # Assuming 0-1 float or 0-255 byte.

            label_idx = y[i].item()
            label_str = dls.vocab[label_idx]

            ax = fig.add_subplot(ROWS, COLS, i + 1)
            ax.imshow(img_tensor)

            ax.set_title(f"{label_str}", fontsize=10)
            ax.axis("off")

        aug_status = "OFF" if args.no_aug else "ON"
        fig.suptitle(f"Batch View (Augmentations: {aug_status})", fontsize=12)
        fig.tight_layout(rect=[0, 0.03, 1, 0.95])
        fig.canvas.draw()

    def on_key(event):
        nonlocal current_batch
        if event.key == "n":
            current_batch = get_next_batch()
            draw_page()
        elif event.key == "p":
            print("Previous batch not supported in streaming iterator mode")
        elif event.key == "q" or event.key == "escape":
            plt.close(fig)

    fig.canvas.mpl_connect("key_press_event", on_key)
    draw_page()
    print("Controls: n=next batch, q/ESC=quit")
    plt.show()


if __name__ == "__main__":
    show_samples()
