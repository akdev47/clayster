from products.models import Product

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