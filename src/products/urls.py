from django.urls import path

from . import views

app_name = "products"

urlpatterns = [
    path("", views.index, name="index"),
    path("add/", views.add, name="add"),
    path("<int:product_id>/", views.product, name="product"),
    path("<int:product_id>/edit/", views.edit, name="edit"),
    path("<int:product_id>/delete/", views.delete, name="delete"),
    path("<int:product_id>/download/", views.download_stl, name='download_stl'),
    path(
        "<int:product_id>/stock/",
        views.adjust_stock,
        name="adjust_stock",
    ),

    path(
        "<int:product_id>/production/",
        views.add_to_production,
        name="add_to_production",
    ),
]