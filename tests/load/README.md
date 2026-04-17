# Load Tests

## k6 API load

```bash
BASE_URL=http://localhost:4000 AUTH_TOKEN=<jwt> k6 run tests/load/api-load.k6.js
```

- `AUTH_TOKEN` is optional. When set, the script hits `POST /workflows` with role modes `cmo + auto`.
- Without a token, it only checks `/health`.