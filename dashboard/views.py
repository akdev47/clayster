from django.shortcuts import render, HttpResponse

def index(request):
    return render(request, "dashboard/index.html")

def oefenscherm(request):
    return HttpResponse("Oefenscherm. Oefenschikking.")

