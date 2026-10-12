from decimal import Decimal

from django.contrib.admin.views.decorators import staff_member_required
from django.db import transaction
from django.db.models import Q, Sum, F
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.contrib import messages
from django.views.decorators.http import require_POST
from django.http import Http404
from django.conf import settings

from products.utils import create_dummy_product

from production.models import ProductionJob
from products.models import Product

from .forms import CheckoutForm
from .models import Order, OrderItem
from .utils import create_test_order

@transaction.atomic
def checkout(request):
    if request.method == "POST":
        form = CheckoutForm(request.POST)

        if form.is_valid():
            customer_info = form.save()

            product = create_dummy_product()
            quantity = 1

            subtotal = product.price * quantity
            shipping = Decimal("10.0")

            order = Order.objects.create(
                customer=customer_info,
                subtotal_price=subtotal,
                shipping_costs=shipping,
                total_price=shipping + subtotal,
            )

            order_item = OrderItem.objects.create(
                name=product.name,
                order=order,
                product=product,
                quantity=quantity,
                unit_price=product.price,
            )

            if product.product_type == Product.ProductType.CUSTOM_STAMP:
                ProductionJob.objects.create(
                    product=product,
                    order_item=order_item,
                    quantity=quantity,
                )

            request.session["order_id"] = order.pk

            return redirect("orders:payment")

    else:
        form = CheckoutForm()

    return render(
        request,
        "orders/checkout.html",
        {"form": form},
    )

@staff_member_required
@require_POST
def test_custom_order(request):
    if not settings.DEBUG:
        raise Http404()

    product = Product.objects.create(
        name="Test Custom Stamp",
        short_description="Personalized stamp for testing",
        long_description="Automatically generated test product.",
        price=Decimal("19.95"),
        product_type=Product.ProductType.CUSTOM_STAMP,
        on_website=False,
    )

    order = create_test_order(product)

    messages.success(
        request,
        f"Test order #{order.id} created successfully.",
    )

    return redirect("orders:order", order_id=order.id)

@staff_member_required
@require_POST
def test_standard_order(request):
    if not settings.DEBUG:
        raise Http404()

    product = get_object_or_404(
        Product,
        pk=request.POST.get("product_id"),
        product_type=Product.ProductType.STANDARD,
    )

    order = create_test_order(product)

    messages.success(
        request,
        f"Test order #{order.id} created successfully.",
    )

    return redirect("orders:order", order_id=order.id)

def payment(request):
    order_id = request.session.get("order_id")

    if order_id is None:
        return redirect("orders:checkout")

    order = get_object_or_404(
        Order,
        pk=order_id,
    )

    return render(
        request,
        "orders/payment.html",
        {"order": order},
    )


@staff_member_required
def index(request):
    current_status = request.GET.get("status", "")
    search = request.GET.get("search", "")

    orders = (
        Order.objects
        .select_related("customer")
        .annotate(
            item_count=Coalesce(
                Sum("items__quantity"),
                0,
            )
        )
        .order_by("-created_at")
    )

    # Filter by status
    if current_status:
        orders = orders.filter(
            order_status=current_status
        )

    # Search by customer or order number
    if search:
        search_filter = (
            Q(customer__first_name__icontains=search)
            | Q(customer__last_name__icontains=search)
            | Q(customer__email__icontains=search)
        )

        if search.isdigit():
            search_filter |= Q(pk=int(search))

        orders = orders.filter(search_filter)

    processing_count = Order.objects.filter(
        order_status=Order.OrderStatus.PROCESSING
    ).count()

    ready_count = Order.objects.filter(
        order_status=Order.OrderStatus.READY
    ).count()

    today_count = Order.objects.filter(
        created_at__date=timezone.localdate()
    ).count()

    return render(
        request,
        "orders/index.html",
        {
            "orders": orders,
            "processing_count": processing_count,
            "ready_count": ready_count,
            "today_count": today_count,
            "current_status": current_status,
            "search": search,
        },
    )


@staff_member_required
def order(request, order_id):
    order = get_object_or_404(
        Order.objects
        .select_related(
            "customer",
            "address",
        )
        .prefetch_related(
            "items__product",
            "items__production_jobs",

        ),
        pk=order_id,
    )

    return render(
        request,
        "orders/order.html",
        {
            "order": order,
            "order_statuses": Order.OrderStatus.choices,
        },
    )

@staff_member_required
@require_POST
@transaction.atomic
def change_status(request, order_id):
    order = get_object_or_404(
        Order.objects.select_for_update(),
        pk=order_id,
    )

    new_status = request.POST.get("status")

    valid_statuses = [
        status.value
        for status in Order.OrderStatus
    ]

    if new_status not in valid_statuses:
        messages.error(request, "Invalid order status.")
        return redirect("orders:order", order_id=order.id)

    if order.order_status == new_status:
        return redirect("orders:order", order_id=order.id)

    # Cancel order
    if new_status == Order.OrderStatus.CANCELLED:

        if order.order_status in [
            Order.OrderStatus.SHIPPED,
            Order.OrderStatus.COMPLETED,
        ]:
            messages.error(
                request,
                "Shipped or completed orders cannot be cancelled.",
            )
            return redirect("orders:order", order_id=order.id)

        items = (
            order.items
            .select_for_update()
            .select_related("product")
        )

        for item in items:
            if not item.is_ready:
                continue

            if item.product.product_type == Product.ProductType.STANDARD:
                Product.objects.filter(pk=item.product_id).update(
                    available_stock=F("available_stock") + item.quantity,
                )

            item.is_ready = False
            item.save(update_fields=["is_ready"])

        ProductionJob.objects.filter(
            order_item__order=order,
            status=ProductionJob.ProductionStatus.WAITING,
        ).update(
            status=ProductionJob.ProductionStatus.CANCELLED,
        )

    order.order_status = new_status
    order.save(update_fields=["order_status"])

    messages.success(
        request,
        f"Order #{order.id} status changed to {order.get_order_status_display()}.",
    )

    return redirect("orders:order", order_id=order.id)

@staff_member_required
@require_POST
def add_to_production(request, item_id):
    item = get_object_or_404(
        OrderItem.objects.select_related("product", "order"),
        pk=item_id,
    )

    active_job_exists = item.production_jobs.exclude(
        status=ProductionJob.ProductionStatus.CANCELLED
    ).exists()

    if active_job_exists:
        messages.warning(
            request,
            "This item has already been added to production.",
        )
    else:
        ProductionJob.objects.create(
            product=item.product,
            order_item=item,
            quantity=item.quantity,
        )

        messages.success(
            request,
            f"{item.product.name} added to production.",
        )

    return redirect(
        "orders:order",
        order_id=item.order_id,
    )

@staff_member_required
@require_POST
@transaction.atomic
def mark_item_ready(request, item_id):
    item = get_object_or_404(
        OrderItem.objects
        .select_for_update()
        .select_related("product", "order"),
        pk=item_id,
    )

    order = item.order
    product = item.product

    if item.is_ready:
        return redirect("orders:order", order_id=order.id)

    if order.order_status in [
        Order.OrderStatus.SHIPPED,
        Order.OrderStatus.COMPLETED,
        Order.OrderStatus.CANCELLED,
    ]:
        messages.error(request, "This order can no longer be modified.")
        return redirect("orders:order", order_id=order.id)

    # Reserve stock for standard products
    if product.product_type == Product.ProductType.STANDARD:

        updated = Product.objects.filter(
            pk=product.pk,
            stock__gte=item.quantity,
        ).update(
            stock=F("stock") - item.quantity,
        )

        if not updated:
            messages.error(
                request,
                f"Not enough stock for {product.name}.",
            )
            return redirect("orders:order", order_id=order.id)

    item.is_ready = True
    item.save(update_fields=["is_ready"])

    if order.all_items_ready():
        order.order_status = Order.OrderStatus.READY
        order.save(update_fields=["order_status"])

    messages.success(
        request,
        f"{product.name} marked as ready.",
    )

    return redirect("orders:order", order_id=order.id)

@staff_member_required
@require_POST
@transaction.atomic
def undo_item_ready(request, item_id):
    item = get_object_or_404(
        OrderItem.objects
        .select_for_update()
        .select_related("product", "order"),
        pk=item_id,
    )

    order = item.order
    product = item.product

    if not item.is_ready:
        return redirect("orders:order", order_id=order.id)

    if order.order_status in [
        Order.OrderStatus.SHIPPED,
        Order.OrderStatus.COMPLETED,
        Order.OrderStatus.CANCELLED,
    ]:
        messages.error(request, "This order can no longer be modified.")
        return redirect("orders:order", order_id=order.id)

    # Return reserved stock
    if product.product_type == Product.ProductType.STANDARD:
        Product.objects.filter(pk=product.pk).update(
            stock=F("stock") + item.quantity,
        )

    item.is_ready = False
    item.save(update_fields=["is_ready"])

    if order.order_status == Order.OrderStatus.READY:
        order.order_status = Order.OrderStatus.PROCESSING
        order.save(update_fields=["order_status"])

    messages.success(
        request,
        f"{product.name} is no longer marked as ready.",
    )

    return redirect("orders:order", order_id=order.id)