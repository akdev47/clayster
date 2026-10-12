import uuid

import django.db.models.deletion
from django.db import migrations, models

import orders.models


def fill_public_ids(apps, schema_editor):
    """Give every order that already exists its own id before it must be unique."""
    Order = apps.get_model("orders", "Order")
    for order in Order.objects.filter(public_id__isnull=True):
        order.public_id = uuid.uuid4()
        order.save(update_fields=["public_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0006_merge_20261012_1254"),
    ]

    operations = [
        # public_id is added empty, filled for existing rows, then made unique.
        migrations.AddField(
            model_name="order",
            name="public_id",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(fill_public_ids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="order",
            name="public_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="order",
            name="order_status",
            field=models.CharField(
                choices=[
                    ("AP", "Awaiting payment"),
                    ("PR", "Processing"),
                    ("RE", "Ready"),
                    ("SH", "Shipped"),
                    ("CO", "Completed"),
                    ("CA", "Cancelled"),
                ],
                default="PR",
                max_length=2,
            ),
        ),
        migrations.AlterField(
            model_name="orderitem",
            name="stl_file",
            field=models.FileField(blank=True, upload_to=orders.models.order_stl_path),
        ),
        migrations.CreateModel(
            name="Payment",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("provider", models.CharField(max_length=30)),
                ("provider_reference", models.CharField(blank=True, max_length=100)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=10)),
                (
                    "status",
                    models.CharField(
                        choices=[("PE", "Pending"), ("PA", "Paid"), ("FA", "Failed")],
                        default="PE",
                        max_length=2,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                (
                    "order",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payments",
                        to="orders.order",
                    ),
                ),
            ],
        ),
    ]
