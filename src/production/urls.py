from django.urls import path

from . import views

app_name = "production"

urlpatterns = [
    path("", views.index, name="index"),
    path("add", views.add, name="add"),
    path("start", views.start, name="start"),
    path("ready", views.ready, name="ready"),
    path("complete", views.complete, name="complete"),
]