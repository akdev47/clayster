from django.urls import path

from . import public_views

app_name = "orders_public"

urlpatterns = [
    path("<uuid:public_id>/", public_views.order_status, name="order"),
    path("<uuid:public_id>/pay/", public_views.pay, name="pay"),
]
