import React, { useEffect } from "react";
import "./App.css";

function App() {
  useEffect(() => {
    // Load an empty dashboard (no data yet)
    loadDashboard({
      name: "",
      credits: { completed: 0, inProgress: 0, remaining: 0 },
      plan: { first: [], second: [], third: [], fourth: [] },
    });
  }, []);

  function loadDashboard(data) {
    // Student name (blank)
    document.getElementById("student-name").textContent =
      data.name || "—";

    // Reset bars
    document.getElementById("bar-complete").style.width = data.credits.completed + "%";
    document.getElementById("bar-progress").style.width = data.credits.inProgress + "%";
    document.getElementById("bar-remaining").style.width = data.credits.remaining + "%";

    document.getElementById("complete-value").textContent = data.credits.completed;
    document.getElementById("progress-value").textContent = data.credits.inProgress;
    document.getElementById("remaining-value").textContent = data.credits.remaining;

    // Clear course lists
    const years = ["first", "second", "third", "fourth"];
    years.forEach((year, idx) => {
      const ul = document.querySelector(`#year${idx + 1} .course-list`);
      ul.innerHTML = "<li style='color:#888;'>No courses added yet</li>";
    });
  }

  return (
    <div className="App">
      <header className="header">
        <h1>Degree Audit Planner</h1>
        <button id="uploadBtn">Upload What-If</button>
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
      </main>
    </div>
  );
}

export default App;
