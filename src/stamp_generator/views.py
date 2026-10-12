import json
from functools import cache
from pathlib import Path

from django.shortcuts import render
from django.templatetags.static import static

IMPORT_MAP_FILE = Path(__file__).resolve().parent / "importmap.json"


@cache
def import_map():
    """Import map JSON for the npm packages that `npm run vendor` copies to static/vendor/."""
    imports = json.loads(IMPORT_MAP_FILE.read_text())["imports"]
    vendor_url = static("vendor/")
    return json.dumps(
        {"imports": {name: vendor_url + path for name, path in imports.items()}},
        indent=2,
    )


def index(request):
    return render(request, "stamp_generator/index.html", {"import_map": import_map()})
