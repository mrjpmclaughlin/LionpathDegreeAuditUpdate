import React, { useEffect, useState } from "react";
import "./App.css";

function Dashboard() {
  // State Variables
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState("");
  const [data, setData] = useState(null);
  const [popup, setPopup] = useState(null);
  const canon = (str) =>
  String(str || "")
    .replace(/\s+/g, "")  // remove spaces
    .replace(/-/g, "")    // remove hyphens
    .toUpperCase();

  useEffect(() => {
    const close = () => setPopup(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Dashboard State for UI display
  const [dash, setDash] = useState({
    name: "",
    major: "",
    credits: { completed: 0, inProgress: 0, remaining: 0, transfer: 0 },
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
      credits: { completed: 0, inProgress: 0, remaining: 0, transfer: 0 },
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
      const res = await fetch("https://lionpathdegreeauditupdate-production.up.railway.app/upload/pdf", {
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
        ...(sd.Courses?.["Transfer"] || []),
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
      // eslint-disable-next-line no-unused-vars
      const [first = [], second = [], third = [], fourth = []] = sortedYears;

      // Update the dashboard state using real year-based grouping
      setDash({
        name: sd["Student Name"] || "—",
        major: sd["Major / Program"] || "—",
        credits: {
          completed: credits["Completed Credits"] || 0,
          inProgress: credits["In Progress Credits"] || 0,
          remaining: credits["Remaining Credits"] || 0,
          transfer: credits["Transfer Credits"] || 0,

          // NEW: applied totals straight from the audit
          applied: credits["Used Credits"] || 0,
          totalRequired: credits["Total Required"] || 0,
          notUsed: credits["Not Used Credits"] || 0,
        },
        plan: (() => {
          const yearGroups = {
            first: [],
            second: [],
            third: [],
            fourth: [],
          };

          // Collect all courses with objects
          const taken = courses["Taken"] || [];
          const inProg = courses["In Progress"] || [];
          const remaining = courses["Remaining"] || [];

          // Add taken & in-progress courses, grouped by their year if present
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

          // Spread remaining courses ~30 credits (~10 courses) per year
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
  const transfer = toNum(dash.credits.transfer);
  const total = completed + inProgress + remaining + transfer;
  const pct = (v) => (total > 0 ? (v / total) * 100 : 0); // Convert to Percentage
  const applied = toNum(dash.credits.applied);
  const totalRequired = toNum(dash.credits.totalRequired);
  const notUsed = toNum(dash.credits.notUsed);
  const degreeComplete =
    totalRequired > 0 &&
    applied >= totalRequired &&
    remaining === 0;
  // Total credits on the student's record (raw)
  const totalOnRecord = completed + inProgress + transfer + notUsed;

  // How much of the required total is applied
  const pctApplied =
    totalRequired > 0 ? (applied / totalRequired) * 100 : 0;
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
            style={{ marginLeft: "8px", padding: "10px" }}
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
            ["Completed", completed + transfer, "green"],
            ["In Progress", inProgress, "orange"],
            ["Remaining", remaining, "red"],
            ["Transfer", transfer, "skyblue"],
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
          <div className="applied-summary">
            <p>
              <strong>Applied to Degree:</strong>{" "}
              {applied} / {totalRequired || "—"} credits
            </p>
            <p>
              <strong>Total Credits on Record:</strong>{" "}
              {totalOnRecord}
            </p>
          </div>  
        </section>

        {popup && (
          <div
            className="course-popup"
            style={{
              position: "fixed",
              top: popup.y - 5,
              left: popup.x,
              transform: "translate(-50%, -100%)",
              background: "white",
              padding: "10px 14px",
              borderRadius: "8px",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.6)",
              zIndex: 9999,
              minWidth: "180px",
              maxWidth: "260px",
              textAlign: "left",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <strong>{popup.course.code}</strong>
            <div>{popup.course.title}</div>
            <div>
              <strong>Credits:</strong> {popup.course.units}
            </div>
            {popup.course.term && (
              <div>
                <strong>Term:</strong> {popup.course.term}
              </div>
            )}
            {popup.course.grade && (
              <div>
                <strong>Grade:</strong> {popup.course.grade}
              </div>
            )}
            {popup.course.prereqs && popup.course.prereqs !== '[]' && popup.course.title !== "Transfer Course" && (
              <div>
                <strong>Prerequisites:</strong>{" "}
                <div>
                  {(Array.isArray(popup.course.prereqs)
                    ? popup.course.prereqs
                    : (() => {
                        try {
                          return JSON.parse(
                            popup.course.prereqs.replace(/'/g, '"')
                          );
                        } catch {
                          return []; // fallback if parsing fails
                        }
                      })()
                  ).map((p, idx) => (
                    <div key={idx}> ◦ {p}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- Academic Plan Section --- */}
        <section id="academic-plan">
          <h2>Suggested Academic Plan</h2>
          <div className="year-container">
            {(() => {
              const norm = (s) => {
                if (!s) return "";
                const u = String(s).toUpperCase();
                if (u === "COMP" || u.includes("COMPLETE") || u.includes("TAKEN"))
                  return "taken";
                if (u === "IP" || u.includes("PROGRESS")) return "in-progress";
                if (u === "TRANSFER") return "transfer";
                if (u.includes("NOT USED")) return "not-used";
                if (u.includes("REMAIN") || u.includes("PLAN")) return "remaining";
                return "";
              };

              const creditsOf = (c) => (c && (c.units || c.credits)) ? Number(c.units || c.credits) : 3;
              const codeOf = (c) => c && c.code ? canon(c.code) : canon(c);

              // Get structured course data from backend
              const backend = data?.Courses || {};
              const taken = backend["Taken"] || [];
              const inProg = backend["In Progress"] || [];
              const transfer = backend["Transfer"] || [];
              const notUsed = (backend["Not Used"] || []).map((c) => ({
                ...c,
                status: c.status || "Not Used",
              }));

              // Remaining courses that haven't been placed in any year yet
              let remainingPool = (backend["Remaining"] || []).map((c) =>
                typeof c === "string"
                  ? { code: c, status: "Remaining", units: 3 }
                  : { ...c, status: c.status || "Remaining" }
              );
              if (degreeComplete) {
                remainingPool = [];
              }
              // 4 logical “years” based on year field
              const yearGroups = {
                "Year 1": [],
                "Year 2": [],
                "Year 3": [],
                "Year 4": [],
              };

              // Place taken + in-progress courses into their explicit year bucket
              [...taken, ...inProg].forEach((course) => {
                const y = course.year || "Year 1";
                if (!yearGroups[y]) yearGroups[y] = [];
                yearGroups[y].push(course);
              });

              // Flatten into ordered list of year lists
              const yearLists = [
                yearGroups["Year 1"],
                yearGroups["Year 2"],
                yearGroups["Year 3"],
                yearGroups["Year 4"],
              ];

              // Filter out remaining courses already assigned by exact code match
              const existingCodes = new Set(
                yearLists.flat().map(codeOf).filter(Boolean)
              );
              remainingPool = remainingPool.filter(
                (c) => !existingCodes.has(codeOf(c))
              );

              // Utility to sum credits in a year
              const getCredits = (list) =>
                list.reduce((a, c) => a + creditsOf(c), 0);

              const shouldAutoFillRemaining =
                totalRequired > 0 &&
                applied < totalRequired &&           // audit says not fully used yet
                remaining > 0;
              // Fill earlier years with “Remaining” courses, but avoid
              // overwriting years that already have in-progress Fall/Spring
              if (shouldAutoFillRemaining){
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
                  const hasFallSpring =
                    activeTerms.has("FA") && activeTerms.has("SP");

                  // If the year has both FA & SP IP courses, do not auto-fill it
                  if (hasFallSpring) continue;

                  // Soft target of 30 credits per year
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
              }
              // Anything left over becomes “Year 5”
              const year5 = remainingPool.map((c) =>
                typeof c === "string"
                  ? { code: c, status: "Remaining", units: 3 }
                  : { ...c, status: "Remaining" }
              );

              // Create named sections: 4 main years, plus optional Year 5, Transfers, Unused
              const sections = [
                ["First Year", yearLists[0] || []],
                ["Second Year", yearLists[1] || []],
                ["Third Year", yearLists[2] || []],
                ["Fourth Year", yearLists[3] || []],
                ...(year5.length ? [["Fifth Year", year5]] : []),
                ...(transfer.length ? [["Transfers", transfer]] : []),
                ...(notUsed.length ? [["Unused Courses", notUsed]] : []),
              ];

              // Render the cards
              return sections.map(([title, list], i) => {
                const isYearCard = title.includes("Year");

                // Shared renderer for a single course <li>
                const renderCourseItem = (c, keySuffix) => {
                  const status = typeof c === "string" ? "remaining" : norm(c.status);

                  const label =
                    typeof c === "string"
                      ? c
                      : c.code
                      ? (
                          <>
                            <strong>{c.code}</strong> — {c.title || ""}
                            {Array.isArray(c.equivalents_of) &&
                              c.equivalents_of.length > 0 && (
                                <> (equivalent to {c.equivalents_of.join(", ")})</>
                              )}
                          </>
                        )
                      : c.title || "(Unnamed course)";

                  return (
                    <li
                      key={keySuffix}
                      className={`course-item ${status} ${
                        popup?.course?.code === c.code ? "selected" : ""
                      }`}
                      onClick={(e) => {
                        if (typeof c === "string") return;
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopup({
                          course: c,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      style={{ cursor: "pointer", position: "relative" }}
                    >
                      {label}
                      {c.status && <span className="status-text">({c.status})</span>}
                    </li>
                  );
                };

                // For Year cards, split into Fall / Spring / Other
                if (isYearCard) {
                  const fall = list.filter(
                    (c) =>
                      typeof c !== "string" &&
                      (c.term || "").toUpperCase().startsWith("FA")
                  );
                  const spring = list.filter(
                    (c) =>
                      typeof c !== "string" &&
                      (c.term || "").toUpperCase().startsWith("SP")
                  );
                  const other = list.filter((c) => {
                    if (typeof c === "string") return true;
                    const term = (c.term || "").toUpperCase();
                    return !term.startsWith("FA") && !term.startsWith("SP");
                  });

                  return (
                    <div key={i} className="year-card">
                      <h3>{title}</h3>

                      {fall.length > 0 && (
                        <>
                          <h4>Fall</h4>
                          <ul className="course-list">
                            {fall.map((c, idx) =>
                              renderCourseItem(c, `FA-${i}-${idx}`)
                            )}
                          </ul>
                        </>
                      )}

                      {spring.length > 0 && (
                        <>
                          <h4>Spring</h4>
                          <ul className="course-list">
                            {spring.map((c, idx) =>
                              renderCourseItem(c, `SP-${i}-${idx}`)
                            )}
                          </ul>
                        </>
                      )}

                      {other.length > 0 && (
                        <>
                          <h4>Other / No Term</h4>
                          <ul className="course-list">
                            {other.map((c, idx) =>
                              renderCourseItem(c, `OT-${i}-${idx}`)
                            )}
                          </ul>
                        </>
                      )}
                    </div>
                  );
                }

                // Non-year sections (Transfers, Unused Courses)
                return (
                  <div key={i} className="year-card">
                    <h3>{title}</h3>
                    <ul className="course-list">
                      {list.map((c, j) => renderCourseItem(c, `${i}-${j}`))}
                    </ul>
                  </div>
                );
              });

            })()}
          </div>
        </section>


        {/* --- Summary Section --- */}
        {String(summary || "").trim() && (
          <section id="summary">
            <h2 id="summary-header">Extracted Summary</h2>
            <pre id="summary-body" style={{ whiteSpace: "pre-wrap" }}>
              {summary}
            </pre>
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
