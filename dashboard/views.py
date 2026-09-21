from django.shortcuts import render, HttpResponse

def index(request):
    return HttpResponse("Schikken")

def oefenscherm(request):
    return HttpResponse("Oefenscherm. Oefenschikking.")

