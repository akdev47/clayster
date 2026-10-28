from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST
from django.contrib.admin.views.decorators import staff_member_required

from .forms import ProductionJobForm
from .models import ProductionJob

@staff_member_required
def index(request):
    jobs = ProductionJob.objects.select_related("product", "order_item__product")
    current_job = jobs.filter(
        status=ProductionJob.ProductionStatus.PRINTING
    ).first()

    waiting_jobs = jobs.filter(
        status=ProductionJob.ProductionStatus.WAITING
    ).order_by("created_at")

    ready_jobs = jobs.filter(
        status=ProductionJob.ProductionStatus.READY
    ).order_by("created_at")

    completed_jobs = jobs.filter(
        status=ProductionJob.ProductionStatus.COMPLETED
    ).order_by("-completed_at")[:10]

    return render(request, "production/index.html", {
        "current_job": current_job,
        "waiting_jobs": waiting_jobs,
        "ready_jobs": ready_jobs,
        "completed_jobs": completed_jobs,
    })

@staff_member_required
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

@staff_member_required
@require_POST
def start(request, job_id):
    job = get_object_or_404(ProductionJob, pk=job_id)

    currently_printing = ProductionJob.objects.filter(
        status=ProductionJob.ProductionStatus.PRINTING
    ).exists()

    if currently_printing:
        messages.error(
            request,
            "Another production job is already printing."
        )
        return redirect("production:index")

    job.status = ProductionJob.ProductionStatus.PRINTING
    job.started_at = timezone.now()
    job.save()

    return redirect("production:index")

@staff_member_required
@require_POST
def ready(request, job_id):
    job = get_object_or_404(ProductionJob, pk=job_id)

    if job.status == ProductionJob.ProductionStatus.PRINTING:
        job.status = ProductionJob.ProductionStatus.READY
        job.save()

    return redirect("production:index")

@staff_member_required
@require_POST
def complete(request, job_id):
    job = get_object_or_404(ProductionJob, pk=job_id)

    if job.status == ProductionJob.ProductionStatus.READY:
        job.status = ProductionJob.ProductionStatus.COMPLETED
        job.completed_at = timezone.now()

        job.product.stock += job.quantity

        job.product.save()
        job.save()

    return redirect("production:index")

@staff_member_required
@require_POST
def cancel(request, job_id):
    job = get_object_or_404(ProductionJob, pk=job_id)

    if job.status not in [
        ProductionJob.ProductionStatus.COMPLETED,
        ProductionJob.ProductionStatus.CANCELLED,
    ]:
        job.status = ProductionJob.ProductionStatus.CANCELLED
        job.save()

    return redirect("production:index")

@staff_member_required
@require_POST
def stop(request, job_id):
    job = get_object_or_404(ProductionJob, pk=job_id)

    if job.status == ProductionJob.ProductionStatus.PRINTING:
        job.status = ProductionJob.ProductionStatus.WAITING
        job.started_at = None
        job.save()

    return redirect("production:index")
