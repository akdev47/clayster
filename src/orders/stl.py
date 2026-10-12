"""Checks an uploaded binary STL before it is stored for production.

The file comes from the customer's browser, so it is treated as untrusted:
only its structure is read here (never executed or rendered), and anything that
does not look like the stamp the tool exports is rejected.
"""

import math
import struct
from dataclasses import dataclass

MAX_STL_BYTES = 10 * 1024 * 1024  # a stamp with a handle is about 2.3 MB
MAX_COORDINATE_MM = 1000

_HEADER_BYTES = 80
_COUNT_BYTES = 4
_TRIANGLE_BYTES = 50  # 12 floats (normal and 3 vertices) and a 2-byte attribute
_TRIANGLE = struct.Struct("<12fH")


class StlError(ValueError):
    """The file is not an acceptable stamp STL."""


@dataclass(frozen=True)
class StlInfo:
    triangles: int
    extents_mm: tuple  # size along x, y and z


def read_stl(data):
    """Returns the triangle count and size of a binary STL, or raises StlError."""
    if len(data) > MAX_STL_BYTES:
        raise StlError("The stamp file is too large.")
    start = _HEADER_BYTES + _COUNT_BYTES
    if len(data) < start:
        raise StlError("The stamp file is not a binary STL.")

    (count,) = struct.unpack_from("<I", data, _HEADER_BYTES)
    if count == 0 or len(data) != start + count * _TRIANGLE_BYTES:
        raise StlError("The stamp file is not a binary STL.")

    low = [math.inf] * 3
    high = [-math.inf] * 3
    for values in _TRIANGLE.iter_unpack(memoryview(data)[start:]):
        for vertex in (values[3:6], values[6:9], values[9:12]):
            for axis, value in enumerate(vertex):
                if not -MAX_COORDINATE_MM < value < MAX_COORDINATE_MM:  # also rejects NaN
                    raise StlError("The stamp file has invalid coordinates.")
                if value < low[axis]:
                    low[axis] = value
                if value > high[axis]:
                    high[axis] = value

    return StlInfo(count, tuple(h - l for l, h in zip(low, high)))


def extents_match(extents_mm, claimed_mm, tolerance_mm=0.5):
    """True if the file's size matches the claimed size, whichever way round it is."""
    claimed = sorted(claimed_mm)
    return all(
        abs(actual - expected) <= tolerance_mm
        for actual, expected in zip(sorted(extents_mm), claimed)
    )
