from django.shortcuts import render, get_object_or_404, redirect
from django.db.models import Q, Sum, Value, IntegerField
from django.db.models.functions import Coalesce
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib import messages
from django.db import transaction
from django.db.models import F
from django.views.decorators.http import require_POST
from django.db.models.deletion import ProtectedError

from .models import Product
from production.models import ProductionJob

from django.http import FileResponse, Http404

from .forms import ProductForm

@staff_member_required
def index(request):
    products = Product.objects.annotate(
        in_production=Coalesce(
            Sum(
                "production_jobs__quantity",
                filter=Q(
                    production_jobs__status__in=[
                        ProductionJob.ProductionStatus.WAITING,
                        ProductionJob.ProductionStatus.PRINTING,
                    ]
                ),
            ),
            Value(0),
            output_field=IntegerField(),
        )
    ).order_by("name")

    search = request.GET.get("search", "").strip()
    product_type = request.GET.get("type", "")
    visibility = request.GET.get("visibility", "")

    if search:
        products = products.filter(
            Q(name__icontains=search)
            | Q(short_description__icontains=search)
        )

    if product_type in Product.ProductType.values:
        products = products.filter(product_type=product_type)

    if visibility == "visible":
        products = products.filter(on_website=True)
    elif visibility == "hidden":
        products = products.filter(on_website=False)

    return render(
        request,
        "products/index.html",
        {
            "products": products,
            "search": search,
            "selected_type": product_type,
            "selected_visibility": visibility,
            "product_types": Product.ProductType.choices,
        },
    )

@staff_member_required
def product(request, product_id):
    product = get_object_or_404(
        Product.objects.select_related("category"),
        pk=product_id,
    )

    production_jobs = (
        product.production_jobs
        .select_related("order_item__order")
        .order_by("-created_at")
    )

    total_units_ordered = product.order_items.aggregate(
        total=Coalesce(Sum("quantity"), 0)
    )["total"]

    return render(request, "products/product.html", {
        "product": product,
        "production_jobs": production_jobs,
        "total_units_ordered": total_units_ordered,
    })

@staff_member_required
def add(request):
    if request.method == "POST":
        form = ProductForm(request.POST, request.FILES)
        if form.is_valid():
            form.save()
            return redirect("products:index")
    else:
        form = ProductForm()

    return render(request, "products/add.html", {
        "form": form,
    })

@staff_member_required
def edit(request, product_id):
    product = get_object_or_404(Product, pk=product_id)

    if request.method == "POST":
        form = ProductForm(request.POST, request.FILES, instance=product)

        if form.is_valid():
            form.save()
            return redirect("products:product", product_id=product.id)

    else:
        form = ProductForm(instance=product)

    return render(request, "products/edit.html", {
        "form": form,
        "product": product,
    })

@staff_member_required
@require_POST
def delete(request, product_id):
    product = get_object_or_404(Product, pk=product_id)

    try:
        product.delete()
        messages.success(request, "Product deleted successfully.")
        return redirect("products:index")

    except ProtectedError:
        messages.error(
            request,
            "This product cannot be deleted because it is associated "
            "with existing orders or production jobs."
        )
        return redirect("products:edit", product_id=product.id)

@staff_member_required
def download_stl(request, product_id):
    product = get_object_or_404(Product, id=product_id)
    if not product.file:
        raise Http404()
    try:
        file = product.file.open("rb")
    except FileNotFoundError:
        raise Http404() from None
    return FileResponse(
        file,
        as_attachment=True,
        filename=product.file.name,
    )

@staff_member_required
@require_POST
@transaction.atomic
def adjust_stock(request, product_id):
    product = get_object_or_404(Product, pk=product_id)

    if product.product_type != Product.ProductType.STANDARD:
        messages.error(request, "Stock can only be adjusted for standard products.")
        return redirect("products:product", product_id=product.id)

    action = request.POST.get("action")

    if action == "increase":
        Product.objects.filter(pk=product.pk).update(
            stock=F("stock") + 1
        )
        messages.success(request, "Stock increased by 1.")

    elif action == "decrease":
        updated = Product.objects.filter(
            pk=product.pk,
            stock__gt=0,
        ).update(
            stock=F("stock") - 1
        )

        if updated:
            messages.success(request, "Stock decreased by 1.")
        else:
            messages.error(request, "Stock cannot go below zero.")

    else:
        messages.error(request, "Invalid stock adjustment.")

    return redirect("products:product", product_id=product.id)


@staff_member_required
@require_POST
def add_to_production(request, product_id):
    product = get_object_or_404(Product, pk=product_id)

    if product.product_type != Product.ProductType.STANDARD:
        messages.error(
            request,
            "Only standard products can be added to stock production.",
        )
        return redirect("products:product", product_id=product.id)

    try:
        quantity = int(request.POST.get("quantity", "1"))
    except (ValueError, TypeError):
        messages.error(request, "Invalid quantity.")
        return redirect("products:product", product_id=product.id)

    if quantity < 1:
        messages.error(request, "Quantity must be at least 1.")
        return redirect("products:product", product_id=product.id)

    ProductionJob.objects.create(
        product=product,
        quantity=quantity,
    )

    messages.success(
        request,
        f"Added {quantity} × {product.name} to production.",
    )

    return redirect("products:product", product_id=product.id)
