# Ridgeline — the public instance on aislop.cloud.
#
# No npm install: the only runtime dependency is `ws`, which has no
# dependencies of its own, so its folder is copied straight in. That spares the
# droplet a registry round trip on every deploy.
#
# There is no build step either: the client is plain ES modules served as-is,
# and `three` comes from a CDN via the page's import map.

FROM node:22-alpine

WORKDIR /app

COPY package.json     package.json
COPY node_modules/ws  node_modules/ws
COPY server.js        server.js
COPY server           server
COPY shared           shared
COPY public           public

# MAX_ROOMS caps simultaneous games: the droplet has one vCPU shared with
# several other projects, and each occupied game simulates at 60 Hz.
#
# NODE_OPTIONS is set because V8 does not read the cgroup limit and would
# otherwise grow past the container's memory cap and be OOM-killed.
#
# No cookies, no secrets: the lobby is anonymous, and room passwords live only
# in memory for the life of the room.
ENV NODE_ENV=production \
    PORT=8080 \
    MAX_ROOMS=8 \
    NODE_NO_WARNINGS=1 \
    NODE_OPTIONS=--max-old-space-size=80

EXPOSE 8080
USER node

CMD ["node", "server.js"]
