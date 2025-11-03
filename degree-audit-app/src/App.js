import React, { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    // Load empty dashboard initially
    loadDashboard({
      name: "",
      credits: { completed: 0, inProgress: 0, remaining: 0 },
      plan: { first: [], second: [], third: [], fourth: [] },
    });
  }, []);

  function loadDashboard(data) {
    document.getElementById("student-name").textContent = data.name || "—";
    console.log(data);

    // Progress bars
    document.getElementById("bar-complete").style.width =
      data.credits.completed + "%";
    document.getElementById("bar-progress").style.width =
      data.credits.inProgress + "%";
    document.getElementById("bar-remaining").style.width =
      data.credits.remaining + "%";

    // Text values
    document.getElementById("complete-value").textContent =
      data.credits.completed;
    document.getElementById("progress-value").textContent =
      data.credits.inProgress;
    document.getElementById("remaining-value").textContent =
      data.credits.remaining;

    // Clear & load course lists
    const years = ["first", "second", "third", "fourth"];
    years.forEach((year, idx) => {
      const ul = document.querySelector(`#year${idx + 1} .course-list`);
      const list = data.plan[year];
      if (!list || list.length === 0) {
        ul.innerHTML = "<li style='color:#888;'>No courses added yet</li>";
      } else {
        ul.innerHTML = list
          .map((c) => `<li>${c.code || ""} ${c.title || ""}</li>`)
          .join("");
      }
    });
  }

  // Upload handler
  async function handleUpload() {
    if (!file) return alert("Please choose a PDF first.");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);

      // Fetch to FastAPI backend
      const res = await fetch("/upload/pdf", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail || "Upload failed");
      }

      const json = await res.json();
      console.log("Upload response:", json);

      setSummary(json.summary_text || "");
      setData(json.structured_data || null);

      const mapped = {
        name: json.structured_data?.StudentName || "—",
        credits: {
          completed: json.structured_data?.CreditsCompletedPct || 0,
          inProgress: json.structured_data?.CreditsInProgressPct || 0,
          remaining: json.structured_data?.CreditsRemainingPct || 0,
        },
        plan: {
          first:
            json.structured_data?.courses?.filter((c) =>
              c.term?.includes("Year 1")
            ) || [],
          second:
            json.structured_data?.courses?.filter((c) =>
              c.term?.includes("Year 2")
            ) || [],
          third:
            json.structured_data?.courses?.filter((c) =>
              c.term?.includes("Year 3")
            ) || [],
          fourth:
            json.structured_data?.courses?.filter((c) =>
              c.term?.includes("Year 4")
            ) || [],
        },
      };

      loadDashboard(mapped);
    } catch (e) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  }

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
          <strong>Student Name:</strong> <span id="student-name">—</span>
        </section>

        <section id="credit-breakdown">
          <h2>Credit Breakdown</h2>

          <div className="progress">
            <span>Completed</span>
            <div className="bar">
              <div id="bar-complete"></div>
            </div>
            <span id="complete-value">0</span>
          </div>

          <div className="progress">
            <span>In Progress</span>
            <div className="bar">
              <div id="bar-progress"></div>
            </div>
            <span id="progress-value">0</span>
          </div>

          <div className="progress">
            <span>Remaining</span>
            <div className="bar">
              <div id="bar-remaining"></div>
            </div>
            <span id="remaining-value">0</span>
          </div>
        </section>

        <section id="academic-plan">
          <h2>Suggested Academic Plan</h2>
          <div className="year-container">
            <div className="year-card" id="year1">
              <h3>First Year</h3>
              <ul className="course-list"></ul>
            </div>
            <div className="year-card" id="year2">
              <h3>Second Year</h3>
              <ul className="course-list"></ul>
            </div>
            <div className="year-card" id="year3">
              <h3>Third Year</h3>
              <ul className="course-list"></ul>
            </div>
            <div className="year-card" id="year4">
              <h3>Fourth Year</h3>
              <ul className="course-list"></ul>
            </div>
          </div>
        </section>

        {summary && (
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
