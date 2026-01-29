export interface RbacRule {
    method: string;
    pattern: string;
    role: string;
}

export const rules: RbacRule[] = [
    { method: "get", pattern: "/", role: "public" },
    { method: "get", pattern: "/api/health", role: "public" },
    { method: "get", pattern: "/api/debug", role: "public" },
    { method: "get", pattern: "/public/ui**", role: "public" },
    { method: "get", pattern: "/public/models/**", role: "public" },
    { method: "get", pattern: "/public/doc**", role: "public" },
    { method: "get", pattern: "/public/favicon.ico", role: "public" },
    { method: "get", pattern: "/api/users/me", role: "user" },
    { method: "patch", pattern: "/api/users/me", role: "user" },
    { method: "get", pattern: "/api/users", role: "admin" },
    { method: "patch", pattern: "/api/users/*", role: "admin" },
    { method: "get", pattern: "/api/layouts", role: "admin" },
    { method: "get", pattern: "/api/layouts/*", role: "admin" },
    { method: "post", pattern: "/api/layouts/*/images", role: "admin" },
    { method: "get", pattern: "/api/user/layouts", role: "user" },
    { method: "post", pattern: "/api/user/layouts", role: "user" },
    { method: "get", pattern: "/api/user/layouts/*", role: "user" },
    { method: "patch", pattern: "/api/user/layouts/*", role: "user" },
    { method: "delete", pattern: "/api/user/layouts/*", role: "user" },
    { method: "post", pattern: "/api/user/layouts/*/images", role: "user" },
    { method: "get", pattern: "/api/images/*", role: "user" },
    { method: "patch", pattern: "/api/images/*", role: "user" },
    { method: "delete", pattern: "/api/images/*", role: "user" },
    { method: "get", pattern: "/api/admin/images/*", role: "admin" },
    { method: "patch", pattern: "/api/admin/images/*/training", role: "admin" },
    { method: "post", pattern: "/api/db/export", role: "admin" }
];
