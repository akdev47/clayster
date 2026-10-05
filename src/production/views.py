from django.shortcuts import render, get_object_or_404, redirect

from .models import ProductionJob

from .forms import ProductionJobForm

def index(request):
    current_job = ProductionJob.objects.filter(
        status=ProductionJob.ProductionStatus.PRINTING
    ).first()

    waiting_jobs = ProductionJob.objects.filter(
        status=ProductionJob.ProductionStatus.WAITING
    ).order_by("created_at")

    ready_jobs = ProductionJob.objects.filter(
        status=ProductionJob.ProductionStatus.READY
    ).order_by("created_at")

    completed_jobs = ProductionJob.objects.filter(
        status=ProductionJob.ProductionStatus.COMPLETED
    ).order_by("-completed_at")[:10]

    return render(request, "production/index.html", {
        "current_job": current_job,
        "waiting_jobs": waiting_jobs,
        "ready_jobs": ready_jobs,
        "completed_jobs": completed_jobs,
    })

def add(request):
    if request.method == "POST":
        form = ProductionJobForm(request.POST, request.FILES)
        if form.is_valid():
            form.save()
            return redirect("production:index")
    else:
        form = ProductionJobForm()

    return render(request, "production/add.html", {
        "form": form,
    })

def start(request):
    return render(request, "production/index.html")

def ready(request):
    return render(request, "production/index.html")

def complete(request):
    return render(request, "production/index.html")