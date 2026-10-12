from django.urls import path

from . import views

app_name = "orders"

urlpatterns = [
    path("", views.index, name="index"),

    path(
        "<int:order_id>/",
        views.order,
        name="order",
    ),

    path(
        "<int:order_id>/status/",
        views.change_status,
        name="change_status",
    ),

    path(
        "items/<int:item_id>/stl/",
        views.download_item_stl,
        name="download_item_stl",
    ),

    path(
        "items/<int:item_id>/production/",
        views.add_to_production,
        name="add_to_production",
    ),

    path(
        "test/custom/",
        views.test_custom_order,
        name="test_custom_order",
    ),

    path(
        "test/standard/",
        views.test_standard_order,
        name="test_standard_order",
    ),

    path(
        "items/<int:item_id>/ready/",
        views.mark_item_ready,
        name="mark_item_ready",
    ),

    path(
        "items/<int:item_id>/undo-ready/",
        views.undo_item_ready,
        name="undo_item_ready",
    ),
]