import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("landing", "routes/landing.tsx"),
  route("discover", "routes/discover.tsx"),
  route("jobs/:id", "routes/jobs.$id.tsx"),
  route("jobs/:id/resume/:vid", "routes/jobs.$id_.resume.$vid.tsx"),
  route("jobs/:id/qa/:rid", "routes/jobs.$id_.qa.$rid.tsx"),
  route("settings", "routes/settings.tsx"),
  route("onboarding", "routes/onboarding.tsx"),
] satisfies RouteConfig;
