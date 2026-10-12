from decimal import Decimal

from products.models import Product

CUSTOM_STAMP_PRODUCT_NAME = "Custom clay stamp"

def create_dummy_product():
    dummy_product, _ = Product.objects.get_or_create(
        name="Stamp_Dummy2",
        defaults= {
            "short_description": "This is a test dummy product stamp",
            "price": 10,
            "product_type": Product.ProductType.CUSTOM_STAMP,
        },
    )

    return dummy_product

def get_custom_stamp_product():
    """The one catalogue product that every stamp designed by a customer is an order item of."""
    product = (
        Product.objects.filter(
            product_type=Product.ProductType.CUSTOM_STAMP,
            name=CUSTOM_STAMP_PRODUCT_NAME,
        )
        .order_by("pk")
        .first()
    )
    if product is None:
        product = Product.objects.create(
            name=CUSTOM_STAMP_PRODUCT_NAME,
            short_description="Custom stamp",
            price=Decimal("8.50"),
            product_type=Product.ProductType.CUSTOM_STAMP,
            on_website=False,
        )
    return product
