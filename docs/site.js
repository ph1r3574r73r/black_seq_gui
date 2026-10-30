(() => {
  // Public site: https://ph1r3574r73r.github.io/black_seq_gui/
  const GITHUB_REPO = "ph1r3574r73r/black_seq_gui";
  const ASSET_NAME = "BlackSequencer-macOS.zip";

  const downloadBtns = [
    document.getElementById("download-btn"),
    document.getElementById("download-btn-main"),
  ].filter(Boolean);
  const releasesLink = document.getElementById("releases-link");
  const issuesLinks = [...document.querySelectorAll("#issues-link, a[data-issues]")];
  const navSource = document.getElementById("nav-source");
  const releaseMeta = document.getElementById("release-meta");
  const downloadStatus = document.getElementById("download-status");

  function inferRepo() {
    if (GITHUB_REPO) return GITHUB_REPO;
    const host = location.hostname || "";
    if (!host.endsWith(".github.io")) return "";
    const user = host.slice(0, -".github.io".length);
    const repo = location.pathname.split("/").filter(Boolean)[0] || `${user}.github.io`;
    if (!user) return "";
    return `${user}/${repo}`;
  }

  function setDisabled(disabled) {
    for (const btn of downloadBtns) {
      const isHero = btn.id === "download-btn";
      btn.setAttribute("aria-disabled", disabled && !isHero ? "true" : "false");
      if (disabled && !isHero) {
        btn.href = "#download";
      }
    }
  }

  function wire(repo, assetUrl, tag, publishedAt) {
    const releasesUrl = `https://github.com/${repo}/releases`;
    const latestUrl = `${releasesUrl}/latest`;
    for (const btn of downloadBtns) {
      btn.href = assetUrl || latestUrl;
      btn.removeAttribute("aria-disabled");
    }
    if (releasesLink) releasesLink.href = releasesUrl;
    for (const link of issuesLinks) {
      link.href = `https://github.com/${repo}/issues`;
    }
    if (navSource) {
      navSource.hidden = false;
      navSource.href = `https://github.com/${repo}`;
    }
    if (assetUrl && tag) {
      const when = publishedAt
        ? new Date(publishedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "";
      const label = when ? `${tag} · ${when}` : tag;
      if (releaseMeta) {
        releaseMeta.hidden = false;
        releaseMeta.textContent = label;
      }
      if (downloadStatus) {
        downloadStatus.textContent = `Latest release ${label}. Unsigned macOS build — right-click → Open the first time if Gatekeeper blocks it.`;
      }
    } else if (downloadStatus) {
      downloadStatus.textContent =
        "No packaged build published yet. Use All releases once a macOS zip is attached, or run from source.";
    }
  }

  async function boot() {
    const repo = inferRepo();
    if (!repo) {
      setDisabled(true);
      if (downloadStatus) {
        downloadStatus.textContent =
          "Set GITHUB_REPO in docs/site.js (or host on GitHub Pages) so the download button can find releases.";
      }
      return;
    }

    wire(repo, "", "", "");
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (res.status === 404) {
        wire(repo, "", "", "");
        return;
      }
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const asset = (data.assets || []).find((a) => a.name === ASSET_NAME);
      wire(
        repo,
        asset ? asset.browser_download_url : "",
        data.tag_name || "",
        data.published_at || ""
      );
      if (!asset && downloadStatus) {
        downloadStatus.textContent = `Latest tag ${data.tag_name || ""} has no ${ASSET_NAME} yet. Open All releases or run from source.`;
      }
    } catch (err) {
      wire(repo, "", "", "");
      if (downloadStatus) {
        downloadStatus.textContent = `Could not reach GitHub Releases (${err.message}). Try All releases.`;
      }
    }
  }

  boot();
})();
