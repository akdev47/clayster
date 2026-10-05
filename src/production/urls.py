from django.urls import path

from . import views

app_name = "production"

urlpatterns = [
    path("", views.index, name="index"),
    path("add", views.add, name="add"),
    path("<int:job_id>/start/", views.start, name="start"),
    path("<int:job_id>/ready/", views.ready, name="ready"),
    path("<int:job_id>/complete/", views.complete, name="complete"),
]