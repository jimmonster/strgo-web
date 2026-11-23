"""Small WebP previews of stored images, with their original dimensions."""

from io import BytesIO

from PIL import Image, ImageOps

from .security import Problem


MAX_SOURCE_BYTES = 24 * 1024 * 1024
MAX_SOURCE_PIXELS = 16 * 1024 * 1024


def make_thumbnail(data):
    try:
        with Image.open(BytesIO(data), formats=('JPEG', 'PNG', 'WEBP')) as image:
            if image.width * image.height > MAX_SOURCE_PIXELS:
                raise Problem(422, '图片尺寸过大，无法生成预览。')
            ImageOps.exif_transpose(image, in_place=True)
            width, height = image.size
            image.thumbnail((320, 160))
            output = BytesIO()
            image.convert('RGB').save(output, format='WEBP', quality=72)
            return output.getvalue(), width, height
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise Problem(422, '图片无法生成预览。') from error
