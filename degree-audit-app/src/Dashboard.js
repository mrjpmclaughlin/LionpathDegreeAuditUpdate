import React, { useEffect, useState } from "react";
import "./App.css";

function Dashboard() {
  // State Variables
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState("");
  const [data, setData] = useState(null);

  // Dashboard State for UI display
  const [dash, setDash] = useState({
    name: "",
    major: "",
    credits: { completed: 0, inProgress: 0, remaining: 0 },
    plan: { first: [], second: [], third: [], fourth: [] },
  });

  // Helper Function for Safely Converting Values to Numbers
  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const m = String(v).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };

  // Reset Dashboard
  useEffect(() => {
    setDash({
      name: "",
      major: "",
      credits: { completed: 0, inProgress: 0, remaining: 0 },
      plan: { first: [], second: [], third: [], fourth: [] },
    });
  }, []);

  // File Upload Handler
  async function handleUpload() {
    if (!file) return alert("Please choose a PDF first.");
    setUploading(true);
    try {
      // Create FormData and Append Selected PDF
      const form = new FormData();
      form.append("file", file);

      // POST Request to FastAPI Backend
      const res = await fetch("http://localhost:8000/upload/pdf", {
        method: "POST",
        body: form,
      });

      // Handle Backend Errors
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail || "Upload failed");
      }

      const json = await res.json();
      console.log("Upload response:", json);

      // Extract Summary Text from Backend Response
      const summaryCandidate =
        json.summary ||
        json.summary_text ||
        json.summaryText ||
        json?.structured_data?.Summary ||
        "";
      setSummary(
        typeof summaryCandidate === "string"
          ? summaryCandidate
          : JSON.stringify(summaryCandidate, null, 2)
      );

      // Align with FastAPI’s structured_data layout
      const sd = json.structured_data || {};
      const credits = sd.Credits || {};
      const courses = sd.Courses || {};

setData(sd); // Store Backend Data

// Combine completed + in-progress courses for year grouping
const allCourses = [
  ...(sd.Courses?.["Taken"] || []),
  ...(sd.Courses?.["In Progress"] || []),
];

// Group courses by 'year' field returned from backend
const groupedByYear = allCourses.reduce((acc, c) => {
  const year = c.year || "Year 1";
  if (!acc[year]) acc[year] = [];
  acc[year].push(c);
  return acc;
}, {});

// Sort by numeric year order (Year 1 → Year 2 → Year 3 → ...)
const sortedYears = Object.keys(groupedByYear)
  .sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, "")) || 0;
    const nb = parseInt(b.replace(/\D/g, "")) || 0;
    return na - nb;
  })
  .map((k) => groupedByYear[k]);

// Safely destructure into four year “buckets” (fallback if fewer years)
const [first = [], second = [], third = [], fourth = []] = sortedYears;

// Update the dashboard state using real year-based grouping
setDash({
  name: sd["Student Name"] || "—",
  major: sd["Major / Program"] || "—",
  credits: {
    completed: credits["Completed Credits"] || 0,
    inProgress: credits["In Progress Credits"] || 0,
    remaining: credits["Remaining Credits"] || 0,
  },
  plan: (() => {
    const yearGroups = {
      first: [],
      second: [],
      third: [],
      fourth: [],
    };

    // 1️⃣ Collect all courses with objects
    const taken = courses["Taken"] || [];
    const inProg = courses["In Progress"] || [];
    const remaining = courses["Remaining"] || [];

    // 2️⃣ Add taken & in-progress courses, grouped by their year if present
    [...taken, ...inProg].forEach((course) => {
      const yr = (course.year || "").toLowerCase();
      if (yr.includes("1")) yearGroups.first.push(course);
      else if (yr.includes("2")) yearGroups.second.push(course);
      else if (yr.includes("3")) yearGroups.third.push(course);
      else if (yr.includes("4")) yearGroups.fourth.push(course);
      else if (course.status?.toLowerCase().includes("progress"))
        yearGroups.second.push(course);
      else yearGroups.first.push(course);
    });

    // 3️⃣ Spread remaining courses ~30 credits (~10 courses) per year
    let bucketIndex = 0;
    const buckets = ["first", "second", "third", "fourth"];
    let creditCount = 0;

    remaining.forEach((c) => {
      const units = c.units || 3; // default 3
      yearGroups[buckets[bucketIndex]].push({
        code: typeof c === "string" ? c : c.code,
        title: typeof c === "string" ? "" : c.title,
        units,
        status: "Remaining",
      });
      creditCount += units;
      if (creditCount >= 30 && bucketIndex < 3) {
        bucketIndex++;
        creditCount = 0;
      }
    });

    return yearGroups;
  })(),
});


    } catch (e) {
      alert(e.message); // Show Error if Upload Fails
    } finally {
      setUploading(false); // Reset Loading State
    }
  }

  // Derived Bar Data for Rendering Credit Bars
  const completed = toNum(dash.credits.completed);
  const inProgress = toNum(dash.credits.inProgress);
  const remaining = toNum(dash.credits.remaining);
  const total = completed + inProgress + remaining;
  const pct = (v) => (total > 0 ? (v / total) * 100 : 0); // Convert to Percentage

  // JSX Rendering
  return (
    <div className="App">
      {/* --- Header Section --- */}
      <header className="header">
        <h1>Degree Audit Planner</h1>
        <div>
          {/* File input */}
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ marginLeft: "8px", padding: "10px" }}
          />
          {/* Upload button */}
          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            id="uploadBtn"
            style={{ marginLeft: "8px", padding: "10px"}}
          >
            {uploading ? "Uploading..." : "Upload What-If"}
          </button>
        </div>
      </header>

      {/* --- Main Content --- */}
      <main>
        {/* --- Student Info Section --- */}
        <section id="student-info">
          <strong>Student Name:</strong>{" "}
          <span id="student-name">{dash.name || "—"}</span>
          <br></br>
          <strong>Selected Major:</strong>{" "}
          <span id="student-name">{dash.major || "—"}</span>
        </section>
        
        {/* --- Credit Breakdown Section --- */}
        <section id="credit-breakdown">
          <h2>Credit Breakdown</h2>

          {[
            ["Completed", completed, "green"],
            ["In Progress", inProgress, "orange"],
            ["Remaining", remaining, "red"],
          ].map(([label, value, color], i) => (
            <div key={i} className="progress">
              <span>{label}</span>
              <div className="bar">
                <div
                  style={{
                    width: pct(value) + "%",
                    backgroundColor: color,
                    height: "100%",
                  }}
                />
              </div>
              <span>{value}</span>
            </div>
          ))}
        </section>

{/* --- Academic Plan Section --- */}
<section id="academic-plan">
  <h2>Suggested Academic Plan</h2>
  <div className="year-container">
    {(() => {
      const norm = (s) => {
        if (!s) return "";
        const u = String(s).toUpperCase();
        if (u === "COMP" || u.includes("COMPLETE") || u.includes("TAKEN")) return "taken";
        if (u === "IP" || u.includes("PROGRESS")) return "in-progress";
        if (u.includes("NOT USED")) return "not-used";
        if (u.includes("REMAIN") || u.includes("PLAN")) return "remaining";
        return "";
      };

      const creditsOf = (c) => (c && (c.units || c.credits)) ? Number(c.units || c.credits) : 3;
      const codeOf = (c) => (typeof c === "string" ? c : (c.code || "").trim());

      // Get structured course data from backend
      const backend = data?.Courses || {};
      const taken = backend["Taken"] || [];
      const inProg = backend["In Progress"] || [];
      const notUsed = (backend["Not Used"] || []).map((c) => ({
        ...c,
        status: c.status || "Not Used",
      }));

      let remainingPool = (backend["Remaining"] || []).map((c) =>
        typeof c === "string"
          ? { code: c, status: "Remaining", units: 3 }
          : { ...c, status: c.status || "Remaining" }
      );

      // Group by year field directly from backend (Year 1–4)
      const yearGroups = { "Year 1": [], "Year 2": [], "Year 3": [], "Year 4": [] };

      [...taken, ...inProg].forEach((course) => {
        const y = course.year || "Year 1";
        if (!yearGroups[y]) yearGroups[y] = [];
        yearGroups[y].push(course);
      });

      const yearLists = [
        yearGroups["Year 1"],
        yearGroups["Year 2"],
        yearGroups["Year 3"],
        yearGroups["Year 4"],
      ];

      // Remove duplicates from Remaining
      const existingCodes = new Set(yearLists.flat().map(codeOf).filter(Boolean));
      remainingPool = remainingPool.filter((c) => !existingCodes.has(codeOf(c)));

      // Helper to count total credits in a year
      const getCredits = (list) => list.reduce((a, c) => a + creditsOf(c), 0);

      // Fill incomplete years (<30 credits) with Remaining,
      // but skip years that are active across both FA and SP terms
      for (let i = 0; i < 4 && remainingPool.length > 0; i++) {
        const list = yearLists[i] || [];
        const nextYear = yearLists[i + 1] || [];
        const currentCredits = getCredits(list);

        // Skip if the year already has 30+ credits
        if (currentCredits >= 30) continue;

        // Skip if student has moved on to the next year
        if (nextYear && nextYear.length > 0) continue;

        // Detect if the year has in-progress Fall + Spring courses
        const activeTerms = new Set(
          list
            .filter((c) => (c.status || "").toUpperCase().includes("IP"))
            .map((c) => (c.term || "").toUpperCase().slice(0, 2)) // "FA", "SP", etc.
        );
        const hasFallSpring = activeTerms.has("FA") && activeTerms.has("SP");

        // Skip if this year is actively planned across both terms
        if (hasFallSpring) continue;

        // Otherwise, this year is inactive and underloaded
        const fillTarget = Math.max(0, 30 - currentCredits);
        if (fillTarget === 0) continue;

        const added = [];
        let acc = 0;
        while (remainingPool.length && acc < fillTarget) {
          const next = remainingPool.shift();
          added.push(
            typeof next === "string"
              ? { code: next, status: "Remaining", units: 3 }
              : { ...next, status: "Remaining" }
          );
          acc += creditsOf(next);
        }

        yearLists[i] = [...list, ...added];
      }


      // Leftover Remaining → Fifth Year
      const year5 = remainingPool.length > 0 ? remainingPool : [];

      // Build final display order
      const sections = [
        ["First Year", yearLists[0] || []],
        ["Second Year", yearLists[1] || []],
        ["Third Year", yearLists[2] || []],
        ["Fourth Year", yearLists[3] || []],
        ...(year5.length ? [["Fifth Year", year5]] : []),
        ...(notUsed.length ? [["Unused Courses", notUsed]] : []),
      ];

      // Render the cards
      return sections.map(([title, list], i) => (
        <div key={i} className="year-card">
          <h3>{title}</h3>
          <ul className="course-list">
            {list.map((c, j) => {
              const status = typeof c === "string" ? "remaining" : norm(c.status);
              const label =
                typeof c === "string"
                  ? c
                  : c.code
                  ? `${c.code} ${c.title || ""}`
                  : c.title || "(Unnamed course)";
              return (
                <li key={j} className={`course-item ${status}`}>
                  {label}
                  {c.status && <span className="status-text">({c.status})</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ));
    })()}



  </div>
</section>

        {/* --- Summary Section --- */}
        {String(summary || "").trim() && (
          <section id="summary">
            <h2 id="summary-header">Extracted Summary</h2>
            <pre style={{ whiteSpace: "pre-wrap" }}>{summary}</pre>
          </section>
        )}

        {/* --- Full Courses Table --- */}
        {data && data.Courses && (
          <section id="course-table">
            <h2>Extracted Courses</h2>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Credits</th>
                  <th>Status</th>
                  <th>Grade</th>
                  <th>Term</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(data.Courses)
                  .flat()
                  .filter((c) => c.code)
                  .map((c, i) => (
                    <tr key={i}>
                      <td>{c.code}</td>
                      <td>{c.title}</td>
                      <td>{c.units || c.credits}</td>
                      <td>{c.status}</td>
                      <td>{c.grade}</td>
                      <td>{c.term}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
