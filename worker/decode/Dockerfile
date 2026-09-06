# VYBZ decode worker — Node + ffmpeg.
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json server.mjs ffmpeg.mjs ./
ENV PORT=8788
EXPOSE 8788
USER node
CMD ["node", "server.mjs"]
