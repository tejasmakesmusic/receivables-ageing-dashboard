import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "@/api/client";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    headers: new Headers(headers),
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("GET returns parsed JSON on 200", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { hello: "world" }));
    const res = await api.get<{ hello: string }>("/test");
    expect(res.hello).toBe("world");
  });

  it("throws ApiError on 401", async () => {
    vi.stubGlobal("fetch", mockFetch(401, { detail: "Unauthorized" }));
    await expect(api.get("/test")).rejects.toBeInstanceOf(ApiError);
  });

  it("ApiError carries status code", async () => {
    vi.stubGlobal("fetch", mockFetch(404, { detail: "Not found" }));
    let caught: ApiError | null = null;
    try {
      await api.get("/test");
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught?.status).toBe(404);
  });

  it("POST sends JSON body with Content-Type header", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await api.post("/test", { foo: "bar" });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toBe(JSON.stringify({ foo: "bar" }));
    expect(((init as RequestInit).headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("POST with FormData does not set Content-Type", async () => {
    const fetchMock = mockFetch(201, { snapshot_id: "abc" });
    vi.stubGlobal("fetch", fetchMock);
    const fd = new FormData();
    fd.append("file", new Blob(["data"]), "test.xlsx");
    await api.post("/snapshots", fd);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    // FormData body — browser sets Content-Type with boundary automatically
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("PATCH sends method PATCH", async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await api.patch("/test/1", { active: false });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe("PATCH");
  });

  it("returns undefined for 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: "No Content",
        json: () => Promise.reject(new Error("no body")),
      } as unknown as Response),
    );
    const res = await api.delete("/test/1");
    expect(res).toBeUndefined();
  });
});
