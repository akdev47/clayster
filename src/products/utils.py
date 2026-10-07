from products.models import Product

def create_dummy_product():
    dummy_product, _ = Product.objects.get_or_create(
        name="Stamp_Dummy",
        defaults= {
            "short_description": "This is a test dummy product stamp",
            "price": 10,
            "product_type": Product.ProductType.STANDARD,
        },
    )

    return dummy_product

def get_custom_stamp_product():
    custom_product, _ = Product.objects.get_or_create(
        name = "Custom clay stamp",
        defaults={
                "short_description": "Custom stamp",
                "price": 8.50,
                "prodcut_type": Product.ProductType.CUSTOM_STAMP,
        },
    )

    return custom_product