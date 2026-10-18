from datetime import datetime, time, timedelta

from django.contrib.admin.views.decorators import staff_member_required
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.shortcuts import HttpResponse, redirect, render
from django.views.decorators.http import require_POST

from customers.models import Customer
from orders.models import Order, OrderItem
from products.utils import create_dummy_product

from django.conf import settings
from products.models import Product
from production.models import ProductionJob

# if we only want users that are superuser:
# @user_passes_test(lambda u: u.is_superuser) 

@staff_member_required
def index(request):
    today = timezone.localdate()
    day_start = timezone.make_aware(datetime.combine(today, time.min))
    day_end = timezone.make_aware(datetime.combine(today + timedelta(days=1), time.min))
    status = Order.OrderStatus
    order_counts = Order.objects.aggregate(
        today=Count("pk", filter=Q(created_at__gte=day_start, created_at__lt=day_end)),
        open=Count("pk", filter=Q(order_status__in=[
            status.AWAITING_PAYMENT, status.PROCESSING, status.READY,
        ])),
        processing=Count("pk", filter=Q(order_status=status.PROCESSING)),
        ready=Count("pk", filter=Q(order_status=status.READY)),
    )
    stage = ProductionJob.ProductionStatus
    production_counts = ProductionJob.objects.aggregate(
        waiting=Count("pk", filter=Q(status=stage.WAITING)),
        printing=Count("pk", filter=Q(status=stage.PRINTING)),
        ready=Count("pk", filter=Q(status=stage.READY)),
    )
    current_job = (
        ProductionJob.objects.filter(status=stage.PRINTING)
        .select_related("product", "order_item__order")
        .order_by("started_at", "pk").first()
    )
    return render(request, "dashboard/index.html", {
        "today": today,
        "order_counts": order_counts,
        "production_counts": production_counts,
        "current_job": current_job,
        "needs_attention": bool(
            order_counts["processing"] or order_counts["ready"] or production_counts["waiting"]
        ),
        "recent_orders": Order.objects.select_related("customer").order_by("-created_at", "-pk")[:5],
        "standard_products": Product.objects.filter(
            product_type=Product.ProductType.STANDARD,
        ).order_by("name") if settings.DEBUG else Product.objects.none(),
        "debug": settings.DEBUG,
    })


def oefenscherm(request):
    return HttpResponse("Oefenscherm. Oefenschikking.")

@staff_member_required
@require_POST
@transaction.atomic
def create_dummy_order(request):
    dummy_customer, _ = Customer.objects.get_or_create(
        email="JohnDoe@dummy.mail.com",
        defaults= {
            "first_name": "John",
            "last_name": "Doe",
        },
        )

    order = Order.objects.create(
        customer=dummy_customer,
        delivery_notes = "Leave at the door",
        subtotal_price = 10,
        shipping_costs = 10,
        total_price = 20,
    )

    product = create_dummy_product()

    orderItem = OrderItem.objects.create(
        name="Dummy Product",
        order=order,
        product=product,
        description="dummy product used for testing",
        unit_price = 10
    )

    return redirect("orders:index")