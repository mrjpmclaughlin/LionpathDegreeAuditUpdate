import React, { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState("");
  const [data, setData] = useState(null);

  // Single source of truth for dashboard
  const [dash, setDash] = useState({
    name: "",
    credits: { completed: 0, inProgress: 0, remaining: 0 },
    plan: { first: [], second: [], third: [], fourth: [] },
  });

  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const m = String(v).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };

  // Initial empty dashboard
  useEffect(() => {
    setDash({
      name: "",
      credits: { completed: 0, inProgress: 0, remaining: 0 },
      plan: { first: [], second: [], third: [], fourth: [] },
    });
  }, []);

  // Upload handler
  async function handleUpload() {
    if (!file) return alert("Please choose a PDF first.");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/upload/pdf", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail || "Upload failed");
      }

      const json = await res.json();
      console.log("Upload response:", json);

      // Summary
      const summaryCandidate =
        json.summary_text ??
        json.summary ??
        json.summaryText ??
        json?.structured_data?.Summary ??
        "";
      setSummary(
        typeof summaryCandidate === "string"
          ? summaryCandidate
          : JSON.stringify(summaryCandidate, null, 2)
      );

      const sd = json.structured_data || {};
      console.log(sd);
      const courses = Array.isArray(sd.courses) ? sd.courses : [];
      setData(sd);

      setDash({
        name: sd.StudentName || "—",
        credits: {
          completed: toNum(sd.CreditsCompleted ?? sd.CreditsCompletedPct),
          inProgress: toNum(sd.CreditsInProgress ?? sd.CreditsInProgressPct),
          remaining: toNum(sd.CreditsRemaining ?? sd.CreditsRemainingPct),
        },
        plan: {
          first: courses.filter((c) => c.term?.includes("Year 1")),
          second: courses.filter((c) => c.term?.includes("Year 2")),
          third: courses.filter((c) => c.term?.includes("Year 3")),
          fourth: courses.filter((c) => c.term?.includes("Year 4")),
        },
      });
    } catch (e) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  }

  // Derived values for bars
  const completed = toNum(dash.credits.completed);
  const inProgress = toNum(dash.credits.inProgress);
  const remaining = toNum(dash.credits.remaining);
  const total = completed + inProgress + remaining;
  const pct = (v) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <div className="App">
      <header className="header">
        <h1>Degree Audit Planner</h1>
        <div>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button
            onClick={handleUpload}
            disabled={uploading || !file}
            id="uploadBtn"
            style={{ marginLeft: "8px" }}
          >
            {uploading ? "Uploading..." : "Upload What-If"}
          </button>
        </div>
      </header>

      <main>
        <section id="student-info">
          <strong>Student Name:</strong> <span id="student-name">{dash.name || "—"}</span>
        </section>

        <section id="credit-breakdown">
          <h2>Credit Breakdown</h2>

          <div className="progress">
            <span>Completed</span>
            <div className="bar">
              <div
                id="bar-complete"
                style={{
                  width: pct(completed) + "%",
                  backgroundColor: "green",
                  height: "100%",
                }}
              />
            </div>
            <span id="complete-value">{completed}</span>
          </div>

          <div className="progress">
            <span>In Progress</span>
            <div className="bar">
              <div
                id="bar-progress"
                style={{
                  width: pct(inProgress) + "%",
                  backgroundColor: "orange",
                  height: "100%",
                }}
              />
            </div>
            <span id="progress-value">{inProgress}</span>
          </div>

          <div className="progress">
            <span>Remaining</span>
            <div className="bar">
              <div
                id="bar-remaining"
                style={{
                  width: pct(remaining) + "%",
                  backgroundColor: "red",
                  height: "100%",
                }}
              />
            </div>
            <span id="remaining-value">{remaining}</span>
          </div>
        </section>

        <section id="academic-plan">
          <h2>Suggested Academic Plan</h2>
          <div className="year-container">
            <div className="year-card" id="year1">
              <h3>First Year</h3>
              <ul className="course-list">
                {(!dash.plan.first || dash.plan.first.length === 0) && (
                  <li style={{ color: "#888" }}>No courses added yet</li>
                )}
                {dash.plan.first?.map((c, i) => (
                  <li key={i}>{`${c.code || ""} ${c.title || ""}`}</li>
                ))}
              </ul>
            </div>
            <div className="year-card" id="year2">
              <h3>Second Year</h3>
              <ul className="course-list">
                {(!dash.plan.second || dash.plan.second.length === 0) && (
                  <li style={{ color: "#888" }}>No courses added yet</li>
                )}
                {dash.plan.second?.map((c, i) => (
                  <li key={i}>{`${c.code || ""} ${c.title || ""}`}</li>
                ))}
              </ul>
            </div>
            <div className="year-card" id="year3">
              <h3>Third Year</h3>
              <ul className="course-list">
                {(!dash.plan.third || dash.plan.third.length === 0) && (
                  <li style={{ color: "#888" }}>No courses added yet</li>
                )}
                {dash.plan.third?.map((c, i) => (
                  <li key={i}>{`${c.code || ""} ${c.title || ""}`}</li>
                ))}
              </ul>
            </div>
            <div className="year-card" id="year4">
              <h3>Fourth Year</h3>
              <ul className="course-list">
                {(!dash.plan.fourth || dash.plan.fourth.length === 0) && (
                  <li style={{ color: "#888" }}>No courses added yet</li>
                )}
                {dash.plan.fourth?.map((c, i) => (
                  <li key={i}>{`${c.code || ""} ${c.title || ""}`}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {String(summary || "").trim() && (
          <section id="summary">
            <h2>Extracted Summary</h2>
            <pre style={{ whiteSpace: "pre-wrap" }}>{summary}</pre>
          </section>
        )}

        {data && Array.isArray(data.courses) && (
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
                {data.courses.map((c, i) => (
                  <tr key={i}>
                    <td>{c.code}</td>
                    <td>{c.title}</td>
                    <td>{c.credits}</td>
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

export default App;
