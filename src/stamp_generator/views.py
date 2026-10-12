import json
from functools import cache
from pathlib import Path

from django.shortcuts import render
from django.templatetags.static import static
from django.urls import reverse

from orders.pricing import pricing_for_page

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
    # Read by the page's scripts (serverConfig.js): the price list for the live
    # estimate, and where to send the finished order.
    config = {
        "pricing": pricing_for_page(),
        "orderEndpoint": reverse("orders_api:create_order"),
    }
    return render(
        request,
        "stamp_generator/index.html",
        {"import_map": import_map(), "config": config},
    )
