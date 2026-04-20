# Minimal Grafana Agent image that bakes in the JAK-Swarm scrape config.
# Deployed as the jak-swarm-grafana-agent Render pserv — scrapes both
# API and Worker over internal DNS and remote_writes to Grafana Cloud.
#
# Pinned to v0.40.0 so a future agent release can't silently change
# config semantics. Bump deliberately in a PR.

FROM grafana/agent:v0.40.0

# Bake the scrape + remote_write config into the image. Env vars
# referenced inside agent.yaml (${GRAFANA_CLOUD_*}) are expanded at
# agent startup from the Render service env.
COPY ops/grafana-agent/agent.yaml /etc/agent/agent.yaml

# Start the agent with the baked config. The agent binary supports
# -config.expand-env to expand ${FOO} against the process env.
ENTRYPOINT ["/bin/grafana-agent"]
CMD ["-config.file=/etc/agent/agent.yaml", "-config.expand-env=true"]
