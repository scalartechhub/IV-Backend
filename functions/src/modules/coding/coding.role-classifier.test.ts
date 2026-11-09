import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCandidateRole } from "./coding.role-classifier";

describe("classifyCandidateRole", () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof classifyCandidateRole>[0];
    expected: string | string[];
  }> = [
    {
      name: "Angular Developer → DSA",
      input: {
        currentRole: "Angular Developer",
        technologies: ["Angular", "TypeScript", "JavaScript", "Firebase"],
      },
      expected: "DSA",
    },
    {
      name: "Full Stack Developer → DSA",
      input: {
        currentRole: "Full Stack Developer",
        technologies: ["React", "Node.js", "Express", "MongoDB"],
      },
      expected: "DSA",
    },
    {
      name: "Java Developer → DSA",
      input: {
        currentRole: "Java Developer",
        technologies: ["Java", "Spring Boot", "MySQL"],
      },
      expected: "DSA",
    },
    {
      name: "Database Administrator → SQL",
      input: {
        currentRole: "Database Administrator",
        technologies: ["SQL Server", "Oracle"],
      },
      expected: "SQL",
    },
    {
      name: "QA Automation Engineer → TESTING",
      input: {
        currentRole: "QA Automation Engineer",
        technologies: ["Selenium", "Java", "TestNG"],
      },
      expected: "TESTING",
    },
    {
      name: "DevOps Engineer → SCRIPTING or CLOUD",
      input: {
        currentRole: "DevOps Engineer",
        technologies: ["Docker", "Jenkins", "Kubernetes", "Linux"],
      },
      expected: ["SCRIPTING", "CLOUD"],
    },
    {
      name: "Data Analyst → SQL or SCRIPTING",
      input: {
        currentRole: "Data Analyst",
        technologies: ["SQL", "Python", "Power BI"],
      },
      expected: ["SQL", "SCRIPTING"],
    },
    {
      name: "Cybersecurity Analyst → SECURITY",
      input: {
        currentRole: "Cybersecurity Analyst",
        technologies: ["SIEM", "Linux", "Python"],
      },
      expected: "SECURITY",
    },
    {
      name: "Network Engineer → NETWORKING",
      input: {
        currentRole: "Network Engineer",
        technologies: ["TCP/IP", "Linux", "Networking"],
      },
      expected: "NETWORKING",
    },
    {
      name: "Engineering Manager → SCENARIO",
      input: {
        currentRole: "Engineering Manager",
        technologies: ["Agile", "Scrum", "Team Management"],
        responsibilities: ["Sprint planning", "Stakeholder communication"],
      },
      expected: "SCENARIO",
    },
    {
      name: "Technical Lead with coding → DSA",
      input: {
        currentRole: "Technical Lead",
        technologies: ["Angular", "Node.js", "architecture"],
        responsibilities: ["Active coding", "Code reviews"],
      },
      expected: "DSA",
    },
    {
      name: "Business Analyst with SQL → SCENARIO or SQL",
      input: {
        currentRole: "Business Analyst",
        technologies: ["SQL", "requirements", "documentation"],
        responsibilities: ["Requirement analysis", "Stakeholder workshops"],
      },
      expected: ["SCENARIO", "SQL"],
    },
  ];

  for (const row of cases) {
    it(row.name, () => {
      const result = classifyCandidateRole(row.input);
      const expected = Array.isArray(row.expected) ? row.expected : [row.expected];
      assert.ok(
        expected.includes(result.assessmentType),
        `${row.name}: got ${result.assessmentType}, expected one of ${expected.join("|")}`
      );
      if (result.assessmentType === "DSA") {
        assert.equal(result.executionMode, "JUDGE0");
      } else if (result.assessmentType === "SQL") {
        assert.equal(result.executionMode, "SQL_EVALUATOR");
      } else {
        assert.equal(result.executionMode, "MANUAL_EVALUATION");
      }
    });
  }
});
