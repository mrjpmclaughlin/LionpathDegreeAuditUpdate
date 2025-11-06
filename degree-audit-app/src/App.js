import React, { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState("");
  const [data, setData] = useState(null);

  // Dashboard state
  const [dash, setDash] = useState({
    name: "",
    major: "",
    credits: { completed: 0, inProgress: 0, remaining: 0 },
    plan: { first: [], second: [], third: [], fourth: [] },
  });

  const toNum = (v) => {
    if (v == null) return 0;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const m = String(v).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  };

  useEffect(() => {
    setDash({
      name: "",
      major: "",
      credits: { completed: 0, inProgress: 0, remaining: 0 },
      plan: { first: [], second: [], third: [], fourth: [] },
    });
  }, []);

  // Correct backend URL + field mapping
  async function handleUpload() {
    if (!file) return alert("Please choose a PDF first.");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("http://localhost:8000/upload/pdf", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail || "Upload failed");
      }

      const json = await res.json();
      console.log("Upload response:", json);

      // Use backend's key name: summary
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

setData(sd);

setDash({
  name: sd["Student Name"] || "—",
  major: sd["Major / Program"] || "—",
  credits: {
    completed: credits["Completed Credits"] || 0,
    inProgress: credits["In Progress Credits"] || 0,
    remaining: credits["Remaining Credits"] || 0,
  },
  plan: {
    first: courses["Taken"] || [],
    second: courses["In Progress"] || [],
    third: courses["Not Used"] || [],
    fourth: courses["Remaining"] || [],
  },
});

    } catch (e) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  }

  // Derived bar data
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
          <strong>Student Name:</strong>{" "}
          <span id="student-name">{dash.name || "—"}</span>
          <br></br>
          <strong>Selected Major:</strong>{" "}
          <span id="student-name">{dash.major || "—"}</span>
        </section>
        
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

        <section id="academic-plan">
          <h2>Suggested Academic Plan</h2>
          <div className="year-container">
            {[
              ["First Year", dash.plan.first],
              ["Second Year", dash.plan.second],
              ["Third Year", dash.plan.third],
              ["Fourth Year", dash.plan.fourth],
            ].map(([title, list], i) => {
              const normalizeStatus = (s) => {
                if (!s) return "";
                const lower = s.toLowerCase();
                if (lower.includes("taken") || lower.includes("complete")) return "taken";
                if (lower.includes("progress")) return "in-progress";
                if (lower.includes("not used")) return "not-used";
                if (lower.includes("remain") || lower.includes("plan")) return "remaining";
                return "";
              };
                return (
                <div key={i} className="year-card">
                  <h3>{title}</h3>
                  <ul className="course-list">
                    {(!list || list.length === 0) && (
                      <li style={{ color: "#888" }}>No courses added yet</li>
                    )}
                    {list?.map((c, j) => {
                      // Normalize backend statuses like COMP/IP/etc.
                      let status = normalizeStatus(c.status);

                      // If status missing, infer from which list it came from
                      if (!status) {
                        const t = title.toLowerCase();
                        if (t.includes("first")) status = "taken";
                        else if (t.includes("second")) status = "in-progress";
                        else if (t.includes("third")) status = "not-used";
                        else if (t.includes("fourth")) status = "remaining";
                      }

                      // Build label
                      const label = c.code ? `${c.code} ${c.title || ""}` : c;

                      return (
                        <li key={j} className={`course-item ${status}`}>
                          {label}
                          {c.status && <span className="status-text">({c.status})</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {String(summary || "").trim() && (
          <section id="summary">
            <h2>Extracted Summary</h2>
            <pre style={{ whiteSpace: "pre-wrap" }}>{summary}</pre>
          </section>
        )}

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

export default App;
