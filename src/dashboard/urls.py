from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("dummy-order", views.create_dummy_order, name="create_dummy_order")
]