from django.urls import path
from . import views

app_name = "stamp_generator"

urlpatterns = [
    path("", views.index, name="index"),
]