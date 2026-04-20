import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { D1DashboardPage } from "@/pages/D1DashboardPage";

const MOCK_TREND_WEEKLY = [
  { week_start: "2026-02-23", total_outstanding: "15000000", ninety_plus: "1200000" },
  { week_start: "2026-03-02", total_outstanding: "15800000", ninety_plus: "1350000" },
  { week_start: "2026-03-09", total_outstanding: "16200000", ninety_plus: "1500000" },
  { week_start: "2026-03-16", total_outstanding: "17000000", ninety_plus: "1700000" },
  { week_start: "2026-03-23", total_outstanding: "17200000", ninety_plus: "1900000" },
  { week_start: "2026-03-30", total_outstanding: "17800000", ninety_plus: "2100000" },
  { week_start: "2026-04-06", total_outstanding: "18400000", ninety_plus: "2300000" },
  { week_start: "2026-04-13", total_outstanding: "18720000", ninety_plus: "4720000" },
];

const MOCK_DASHBOARD = {
  entity: "IND",
  as_of_date: "2025-04-18",
  snapshot_id: "abc-123",
  snapshot_status: "PUBLISHED",
  currency_display: "INR",
  kpis: {
    total_outstanding: "18720000",
    pct_overdue: "24.5",
    parties_with_90plus_count: 3,
    last_snapshot_date: "2025-04-18",
    fx_rate_used: null,
    fx_rate_effective_from: null,
    fx_rate_from_ccy: null,
    fx_rate_to_ccy: null,
  },
  ageing_buckets: {
    NOT_DUE: "5000000",
    "0_30": "4000000",
    "31_60": "3000000",
    "61_90": "2000000",
    "90_PLUS": "4720000",
  },
  top_parties: [
    {
      canonical_id: "party-1",
      canonical_name: "Acme Corp",
      outstanding: "5000000",
      overdue_bucket: "31_60",
      active_exception_count: 2,
      tally_overdue_days_max: null,
      last_follow_up_date: null,
      last_follow_up_channel: null,
    },
  ],
  recent_exceptions: [],
  parties_on_default_credit_period_count: 0,
  trend_weekly: MOCK_TREND_WEEKLY,
};

const MOCK_USER = {
  id: "user-1",
  email: "admin@emb.global",
  name: "Admin",
  role: "ADMIN",
  entity_id_scope: null,
};

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_USER),
        });
      }
      if (url.includes("/dashboard")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(MOCK_DASHBOARD),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    }) as typeof fetch,
  );
});

describe("D1DashboardPage", () => {
  it("renders heading", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    expect(screen.getByText(/AR Dashboard/i)).toBeInTheDocument();
  });

  it("renders entity pills IND / UAE / Consolidated", () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    expect(screen.getByRole("button", { name: "IND" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UAE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Consolidated" })).toBeInTheDocument();
  });

  it("shows KPI tiles after data loads", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Total Outstanding/i)).toBeInTheDocument();
    });
    // Overdue pct tile
    expect(screen.getByText(/% Overdue/i)).toBeInTheDocument();
  });

  it("shows top party in table", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    });
  });

  it("switches entity on pill click", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    const uaePill = screen.getByRole("button", { name: "UAE" });
    fireEvent.click(uaePill);
    expect(uaePill).toHaveAttribute("aria-pressed", "true");
  });

  it("shows default credit period banner with count when count > 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_USER),
          });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ ...MOCK_DASHBOARD, parties_on_default_credit_period_count: 34 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/34 parties using entity default credit period/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/review and add specific terms/i)).toBeInTheDocument();
  });

  it("hides default credit period banner when count is 0", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Total Outstanding/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/using entity default credit period/i),
    ).not.toBeInTheDocument();
  });

  it("Review credit config button links to /credit-period", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_USER),
          });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ ...MOCK_DASHBOARD, parties_on_default_credit_period_count: 5 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/5 parties using entity default credit period/i)).toBeInTheDocument();
    });
    const reviewLink = screen.getByRole("link", { name: /review credit config/i });
    expect(reviewLink).toHaveAttribute("href", "/credit-period");
  });

  it("renders Tally overdue days when tally_overdue_days_max is present", async () => {
    const mockWithTally = {
      ...MOCK_DASHBOARD,
      top_parties: [
        {
          canonical_id: "party-tally",
          canonical_name: "Tally Party",
          outstanding: "3000000",
          overdue_bucket: "31_60",
          active_exception_count: 0,
          tally_overdue_days_max: 45,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_USER) });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockWithTally) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("Tally Party")).toBeInTheDocument();
    });
    // The cell shows "Tally: 45"
    expect(screen.getByText(/Tally: 45/i)).toBeInTheDocument();
  });

  it("renders sparkline SVG with 8-week mock data", async () => {
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("trend-sparkline")).toBeInTheDocument();
    });
    // Two polylines: total AR + 90+ overlay
    const svg = screen.getByLabelText(/8-week AR trend sparkline/i);
    expect(svg).toBeInTheDocument();
    const polylines = svg.querySelectorAll("polyline");
    expect(polylines.length).toBe(2);
  });

  it("renders empty placeholder when trend_weekly is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_USER) });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ ...MOCK_DASHBOARD, trend_weekly: [] }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/No trend data yet/i)).toBeInTheDocument();
    });
  });

  it("renders dash when tally_overdue_days_max is null", async () => {
    const mockNoTally = {
      ...MOCK_DASHBOARD,
      top_parties: [
        {
          canonical_id: "party-notally",
          canonical_name: "No Tally Party",
          outstanding: "2000000",
          overdue_bucket: "NOT_DUE",
          active_exception_count: 0,
          tally_overdue_days_max: null,
          last_follow_up_date: null,
          last_follow_up_channel: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_USER) });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockNoTally) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("No Tally Party")).toBeInTheDocument();
    });
    // No "Tally: X" text rendered — null path shows dash, not overdue number
    expect(screen.queryByText(/Tally: \d+/i)).not.toBeInTheDocument();
    // No tally overdue cell with tooltip rendered
    expect(screen.queryByTestId("tally-overdue-cell")).not.toBeInTheDocument();
  });

  it("renders last follow-up date and channel badge when follow-up exists", async () => {
    const mockWithFollowUp = {
      ...MOCK_DASHBOARD,
      top_parties: [
        {
          canonical_id: "party-fu",
          canonical_name: "FollowUp Party",
          outstanding: "4000000",
          overdue_bucket: "0_30",
          active_exception_count: 0,
          tally_overdue_days_max: null,
          last_follow_up_date: "2026-03-15",
          last_follow_up_channel: "CALL",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_USER) });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockWithFollowUp) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("FollowUp Party")).toBeInTheDocument();
    });
    const cell = screen.getByTestId("last-fu-party-fu");
    // Channel badge should be visible
    expect(cell.textContent).toContain("CALL");
    // Dash should NOT appear
    expect(cell.textContent).not.toBe("—");
  });

  it("renders dash in last follow-up column when follow-up is null", async () => {
    const mockNoFollowUp = {
      ...MOCK_DASHBOARD,
      top_parties: [
        {
          canonical_id: "party-nofu",
          canonical_name: "NoFollowUp Party",
          outstanding: "3000000",
          overdue_bucket: "NOT_DUE",
          active_exception_count: 0,
          tally_overdue_days_max: null,
          last_follow_up_date: null,
          last_follow_up_channel: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_USER) });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockNoFollowUp) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("NoFollowUp Party")).toBeInTheDocument();
    });
    const cell = screen.getByTestId("last-fu-party-nofu");
    expect(cell.textContent).toContain("—");
  });

  // ---------------------------------------------------------------------------
  // Task 18 — FX tooltip on consolidated view (spec §7)
  // ---------------------------------------------------------------------------

  it("consolidated view: KPI total_outstanding tile has FX tooltip title attribute", async () => {
    const mockAll = {
      ...MOCK_DASHBOARD,
      entity: "ALL",
      currency_display: "INR",
      kpis: {
        ...MOCK_DASHBOARD.kpis,
        fx_rate_used: "22.7500",
        fx_rate_effective_from: "2026-01-01",
        fx_rate_from_ccy: "AED",
        fx_rate_to_ccy: "INR",
      },
      top_parties: [
        {
          canonical_id: "party-all-1",
          canonical_name: "Consolidated Party",
          outstanding: "5000000",
          overdue_bucket: "NOT_DUE",
          active_exception_count: 0,
          tally_overdue_days_max: null,
          last_follow_up_date: null,
          last_follow_up_channel: null,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/me")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MOCK_USER) });
        }
        if (url.includes("/dashboard")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockAll) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }) as typeof fetch,
    );

    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("kpi-total-outstanding")).toBeInTheDocument();
    });
    const tile = screen.getByTestId("kpi-total-outstanding");
    expect(tile).toHaveAttribute("title");
    const titleAttr = tile.getAttribute("title") ?? "";
    expect(titleAttr).toContain("AED→INR");
    expect(titleAttr).toContain("22.7500");
    expect(titleAttr).toContain("2026-01-01");
  });

  it("single-entity view: KPI total_outstanding tile has no title attribute", async () => {
    // MOCK_DASHBOARD is entity=IND with fx_rate_used=null
    render(
      <Wrapper>
        <D1DashboardPage />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("kpi-total-outstanding")).toBeInTheDocument();
    });
    const tile = screen.getByTestId("kpi-total-outstanding");
    // title attribute must be absent (null) when there is no FX rate
    expect(tile.getAttribute("title")).toBeNull();
  });
});
