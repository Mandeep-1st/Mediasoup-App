FROM ubuntu:22.04

WORKDIR /usr/src

RUN apt-get update && \
    apt-get install -y build-essential pip net-tools iputils-ping iproute2 curl

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
RUN apt-get install -y nodejs

EXPOSE 3000
EXPOSE 10000-10100
EXPOSE 2000-2020
