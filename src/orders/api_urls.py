from django.urls import path

from . import api

app_name = "orders_api"

urlpatterns = [
    path("orders/", api.create_order, name="create_order"),
]
