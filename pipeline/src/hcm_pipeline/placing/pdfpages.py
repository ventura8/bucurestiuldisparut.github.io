"""An archive PDF's page images (docs/research/M20-import-local.md §3, *PDFs*): taken out with pikepdf, never re-encoded.

Each page's largest image is written as it is stored (a `/DCTDecode` stream becomes a JPEG file byte for byte). A file encrypted with
an empty user password (owner restrictions only, as Miorini 1923's Standard handler) is read; one that needs a password is skipped
(`pdf-password`): the worker never asks for one and never tries to crack it. A page with no image (text only, vector drawing) gives no
file and is counted. The pages are written to the job's scratch folder, never beside the originals.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Final

import pikepdf

LOCKED_REASON: Final = "pdf-password"


@dataclass(frozen=True)
class Pages:
    """The page images taken out, in page order, and the pages that had none."""

    files: tuple[Path, ...]
    without_image: int


def _largest(page: pikepdf.Page) -> pikepdf.PdfImage | None:
    images = [pikepdf.PdfImage(image) for image in page.get_images().values() if isinstance(image, pikepdf.Stream)]
    return max(images, key=lambda image: image.width * image.height, default=None)


def extract_pages(source: Path, target: Path) -> Pages | None:
    """Every page's largest image under `target` (`page-0001.jpg`, ...); None when the PDF needs a password."""
    target.mkdir(parents=True, exist_ok=True)
    try:
        document = pikepdf.open(source)
    except pikepdf.PasswordError:
        return None
    files, missing = [], 0
    with document:
        for number, page in enumerate(document.pages, start=1):
            image = _largest(page)
            if image is None:
                missing += 1
                continue
            files.append(Path(image.extract_to(fileprefix=str(target / f"page-{number:04d}"))))
    return Pages(tuple(files), missing)
