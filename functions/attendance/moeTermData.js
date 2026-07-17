/**
 * Mirrored MoE Zambia term windows for server-side attendance validation.
 *
 * SOURCE OF TRUTH: src/utils/moeCalendar.js — this file is a projection of
 * it (term ids, open/close, ECE mid-term dates, gazetted holidays) because
 * Cloud Functions cannot import from src/. The mirror is enforced by
 * scripts/test-attendance-term-mirror.mjs (npm run test:attendance-term-mirror):
 * change the calendar there and this file must be regenerated to match.
 */

const MOE_TERM_DATA = {
  "2026": [
    {
      "id": "2026-T1",
      "number": 1,
      "open": "2026-01-12",
      "close": "2026-04-10",
      "eceMidStart": "2026-02-23",
      "eceMidEnd": "2026-02-27",
      "holidays": [
        {
          "name": "New Year's Day",
          "date": "2026-01-01"
        },
        {
          "name": "Women's Day",
          "date": "2026-03-08"
        },
        {
          "name": "Youth Day",
          "date": "2026-03-12"
        },
        {
          "name": "Good Friday",
          "date": "2026-04-03"
        },
        {
          "name": "Holy Saturday",
          "date": "2026-04-04"
        },
        {
          "name": "Easter Monday",
          "date": "2026-04-06"
        },
        {
          "name": "Kenneth Kaunda Day",
          "date": "2026-04-28"
        },
        {
          "name": "Labour Day",
          "date": "2026-05-01"
        }
      ]
    },
    {
      "id": "2026-T2",
      "number": 2,
      "open": "2026-05-11",
      "close": "2026-08-07",
      "eceMidStart": "2026-06-22",
      "eceMidEnd": "2026-06-26",
      "holidays": [
        {
          "name": "Africa Freedom Day",
          "date": "2026-05-25"
        },
        {
          "name": "Heroes Day",
          "date": "2026-07-06"
        },
        {
          "name": "Unity Day",
          "date": "2026-07-07"
        },
        {
          "name": "Farmers' Day",
          "date": "2026-08-03"
        }
      ]
    },
    {
      "id": "2026-T3",
      "number": 3,
      "open": "2026-09-07",
      "close": "2026-12-04",
      "eceMidStart": "2026-10-19",
      "eceMidEnd": "2026-10-23",
      "holidays": [
        {
          "name": "Teachers' Day",
          "date": "2026-10-05"
        },
        {
          "name": "National Prayers Day",
          "date": "2026-10-18"
        },
        {
          "name": "Independence Day",
          "date": "2026-10-24"
        },
        {
          "name": "Christmas Day",
          "date": "2026-12-25"
        }
      ]
    }
  ],
  "2027": [
    {
      "id": "2027-T1",
      "number": 1,
      "open": "2027-01-11",
      "close": "2027-04-09",
      "eceMidStart": "2027-02-22",
      "eceMidEnd": "2027-02-26",
      "holidays": [
        {
          "name": "New Year's Day",
          "date": "2027-01-01"
        },
        {
          "name": "Women's Day",
          "date": "2027-03-08"
        },
        {
          "name": "Good Friday",
          "date": "2027-03-26"
        },
        {
          "name": "Holy Saturday",
          "date": "2027-03-27"
        },
        {
          "name": "Easter Monday",
          "date": "2027-03-29"
        },
        {
          "name": "Kenneth Kaunda Day",
          "date": "2027-04-28"
        },
        {
          "name": "Labour Day",
          "date": "2027-05-01"
        }
      ]
    },
    {
      "id": "2027-T2",
      "number": 2,
      "open": "2027-05-10",
      "close": "2027-08-06",
      "eceMidStart": "2027-06-21",
      "eceMidEnd": "2027-06-25",
      "holidays": [
        {
          "name": "Africa Freedom Day",
          "date": "2027-05-25"
        },
        {
          "name": "Heroes Day",
          "date": "2027-07-05"
        },
        {
          "name": "Unity Day",
          "date": "2027-07-06"
        },
        {
          "name": "Farmers' Day",
          "date": "2027-08-02"
        }
      ]
    },
    {
      "id": "2027-T3",
      "number": 3,
      "open": "2027-09-06",
      "close": "2027-12-03",
      "eceMidStart": "2027-10-18",
      "eceMidEnd": "2027-10-22",
      "holidays": [
        {
          "name": "Teachers' Day",
          "date": "2027-10-05"
        },
        {
          "name": "National Prayers Day",
          "date": "2027-10-18"
        },
        {
          "name": "Independence Day",
          "date": "2027-10-24"
        },
        {
          "name": "Christmas Day",
          "date": "2027-12-25"
        }
      ]
    }
  ],
  "2028": [
    {
      "id": "2028-T1",
      "number": 1,
      "open": "2028-01-10",
      "close": "2028-04-07",
      "eceMidStart": "2028-02-21",
      "eceMidEnd": "2028-02-25",
      "holidays": [
        {
          "name": "New Year's Day",
          "date": "2028-01-01"
        },
        {
          "name": "Women's Day",
          "date": "2028-03-08"
        },
        {
          "name": "Good Friday",
          "date": "2028-04-14"
        },
        {
          "name": "Holy Saturday",
          "date": "2028-04-15"
        },
        {
          "name": "Easter Monday",
          "date": "2028-04-17"
        },
        {
          "name": "Kenneth Kaunda Day",
          "date": "2028-04-28"
        },
        {
          "name": "Labour Day",
          "date": "2028-05-01"
        }
      ]
    },
    {
      "id": "2028-T2",
      "number": 2,
      "open": "2028-05-08",
      "close": "2028-08-04",
      "eceMidStart": "2028-06-19",
      "eceMidEnd": "2028-06-23",
      "holidays": [
        {
          "name": "Africa Freedom Day",
          "date": "2028-05-25"
        },
        {
          "name": "Heroes Day",
          "date": "2028-07-03"
        },
        {
          "name": "Unity Day",
          "date": "2028-07-04"
        },
        {
          "name": "Farmers' Day",
          "date": "2028-08-07"
        }
      ]
    },
    {
      "id": "2028-T3",
      "number": 3,
      "open": "2028-09-04",
      "close": "2028-12-01",
      "eceMidStart": "2028-10-16",
      "eceMidEnd": "2028-10-20",
      "holidays": [
        {
          "name": "Teachers' Day",
          "date": "2028-10-05"
        },
        {
          "name": "National Prayers Day",
          "date": "2028-10-18"
        },
        {
          "name": "Independence Day",
          "date": "2028-10-24"
        },
        {
          "name": "Christmas Day",
          "date": "2028-12-25"
        }
      ]
    }
  ],
  "2029": [
    {
      "id": "2029-T1",
      "number": 1,
      "open": "2029-01-08",
      "close": "2029-04-06",
      "eceMidStart": "2029-02-19",
      "eceMidEnd": "2029-02-23",
      "holidays": [
        {
          "name": "New Year's Day",
          "date": "2029-01-01"
        },
        {
          "name": "Women's Day",
          "date": "2029-03-08"
        },
        {
          "name": "Good Friday",
          "date": "2029-03-30"
        },
        {
          "name": "Holy Saturday",
          "date": "2029-03-31"
        },
        {
          "name": "Easter Monday",
          "date": "2029-04-02"
        },
        {
          "name": "Kenneth Kaunda Day",
          "date": "2029-04-28"
        },
        {
          "name": "Labour Day",
          "date": "2029-05-01"
        }
      ]
    },
    {
      "id": "2029-T2",
      "number": 2,
      "open": "2029-05-07",
      "close": "2029-08-03",
      "eceMidStart": "2029-06-18",
      "eceMidEnd": "2029-06-22",
      "holidays": [
        {
          "name": "Africa Freedom Day",
          "date": "2029-05-25"
        },
        {
          "name": "Heroes Day",
          "date": "2029-07-02"
        },
        {
          "name": "Unity Day",
          "date": "2029-07-03"
        },
        {
          "name": "Farmers' Day",
          "date": "2029-08-06"
        }
      ]
    },
    {
      "id": "2029-T3",
      "number": 3,
      "open": "2029-09-03",
      "close": "2029-11-30",
      "eceMidStart": "2029-10-15",
      "eceMidEnd": "2029-10-19",
      "holidays": [
        {
          "name": "Teachers' Day",
          "date": "2029-10-05"
        },
        {
          "name": "National Prayers Day",
          "date": "2029-10-18"
        },
        {
          "name": "Independence Day",
          "date": "2029-10-24"
        },
        {
          "name": "Christmas Day",
          "date": "2029-12-25"
        }
      ]
    }
  ],
  "2030": [
    {
      "id": "2030-T1",
      "number": 1,
      "open": "2030-01-14",
      "close": "2030-04-12",
      "eceMidStart": "2030-02-18",
      "eceMidEnd": "2030-02-22",
      "holidays": [
        {
          "name": "New Year's Day",
          "date": "2030-01-01"
        },
        {
          "name": "Women's Day",
          "date": "2030-03-08"
        },
        {
          "name": "Good Friday",
          "date": "2030-04-19"
        },
        {
          "name": "Holy Saturday",
          "date": "2030-04-20"
        },
        {
          "name": "Easter Monday",
          "date": "2030-04-22"
        },
        {
          "name": "Kenneth Kaunda Day",
          "date": "2030-04-28"
        },
        {
          "name": "Labour Day",
          "date": "2030-05-01"
        }
      ]
    },
    {
      "id": "2030-T2",
      "number": 2,
      "open": "2030-05-13",
      "close": "2030-08-09",
      "eceMidStart": "2030-06-17",
      "eceMidEnd": "2030-06-21",
      "holidays": [
        {
          "name": "Africa Freedom Day",
          "date": "2030-05-25"
        },
        {
          "name": "Heroes Day",
          "date": "2030-07-01"
        },
        {
          "name": "Unity Day",
          "date": "2030-07-02"
        },
        {
          "name": "Farmers' Day",
          "date": "2030-08-05"
        }
      ]
    },
    {
      "id": "2030-T3",
      "number": 3,
      "open": "2030-09-09",
      "close": "2030-12-06",
      "eceMidStart": "2030-10-14",
      "eceMidEnd": "2030-10-28",
      "holidays": [
        {
          "name": "Teachers' Day",
          "date": "2030-10-05"
        },
        {
          "name": "National Prayers Day",
          "date": "2030-10-18"
        },
        {
          "name": "Independence Day",
          "date": "2030-10-24"
        },
        {
          "name": "Christmas Day",
          "date": "2030-12-25"
        }
      ]
    }
  ]
};

module.exports = { MOE_TERM_DATA };
