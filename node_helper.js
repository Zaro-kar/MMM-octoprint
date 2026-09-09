/* Magic Mirror
 * Node Helper: MMM-octoprint
 *
 * By Ben Konsemüller
 * MIT Licensed.
 */

const Log = require("logger");
const NodeHelper = require("node_helper");
const moment = require("moment");

module.exports = NodeHelper.create({
  config: {},
  currentFile: null,
  async socketNotificationReceived(notification, payload) {
    if (notification === "CONFIG") {
      this.config = payload;

      if (this.fetchTimerId) {
        clearTimeout(this.fetchTimerId);
      }

      await this.fetchData();
    }
  },

  async fetchData() {
    const self = this;

    const printer_status = await this.fetchPrinterStatus();

    if (!printer_status || printer_status.error) {
      this.sendSocketNotification("HTTP_ERROR", {});
      this.fetchTimerId = setTimeout(async function () {
        await self.fetchData();
      }, this.config.updateInterval);
      return;
    }

    const job_status = await this.fetchPrinterJob();

    let thumbnail = null;
    let layer_information = null;

    if (this.config.showThumbnail) {
      thumbnail = await this.fetchThumbnail(job_status);
    }

    if (this.config.showLayerProgress) {
      layer_information = await this.fetchLayerInformation();
    }

    const eta = moment
      .utc(1000 * job_status.progress.printTimeLeft)
      .format("HH[h] mm[m] ss[s]");

    const elapsed = moment
      .utc(1000 * job_status.progress.printTime)
      .format("HH[h] mm[m] ss[s]");

    const finishTime = moment()
      .add(job_status.progress.printTimeLeft, "seconds")
      .format("HH:mm:ss");

    this.sendSocketNotification("PRINTER_STATUS", {
      printer_status,
      job_status,
      eta,
      elapsed,
      finishTime,
      layer_information,
      thumbnail,
    });

    this.fetchTimerId = setTimeout(async function () {
      await self.fetchData();
    }, this.config.updateInterval);
  },

  async fetchPrinterStatus() {
    const endpoint = this.config.endpoint + "/api/printer";

    try {
      const response = await fetch(endpoint, { headers: this.getHeaders() });
      const json = await response.json();

      return json;
    } catch (error) {
      Log.error(`${this.name} received an error: ${error}`);
      this.sendSocketNotification("HTTP_ERROR", {});

      return null;
    }
  },

  async fetchPrinterJob() {
    const endpoint = this.config.endpoint + "/api/job";

    try {
      const response = await fetch(endpoint, { headers: this.getHeaders() });
      const json = await response.json();

      return json;
    } catch (error) {
      Log.error(`${this.name} received an error: ${error}`);
      this.sendSocketNotification("HTTP_ERROR", {});

      return null;
    }
  },

  async fetchLayerInformation() {
    const endpoint =
      this.config.endpoint + "/plugin/DisplayLayerProgress/values";

    try {
      const response = await fetch(endpoint, { headers: this.getHeaders() });
      const text = await response.text();

      if (response.headers.get("content-type").includes("application/json")) {
        const json = JSON.parse(text);
        return json;
      } else {
        Log.error(
          `${this.name} received an error: Couldn't fetch layer information. Maybe the DisplayLayerProgress plugin is not installed or activated?`,
        );
        return null;
      }
    } catch (error) {
      Log.error(`${this.name} received an error: ${error}`);
      this.sendSocketNotification("HTTP_ERROR", {});

      return null;
    }
  },

  async fetchThumbnail(job_status) {
    const file = job_status && job_status.job ? job_status.job.file : null;

    // The job API reports "name" as the bare file name. Only "path" contains
    // the folder structure the file API expects.
    const filePath = file ? file.path || file.name : null;

    if (!filePath) {
      return this.getFallbackThumbnail();
    }

    const endpoint =
      this.config.endpoint.replace(/\/+$/, "") +
      "/api/files/" +
      encodeURIComponent(file.origin || "local") +
      "/" +
      filePath.split("/").map(encodeURIComponent).join("/");

    try {
      const response = await fetch(endpoint, { headers: this.getHeaders() });

      if (!response.ok) {
        Log.error(
          `${this.name} could not fetch the thumbnail: ${endpoint} returned ${response.status} ${response.statusText}`,
        );

        return this.getFallbackThumbnail();
      }

      const json = await response.json();

      if (!json.thumbnail) {
        Log.warn(
          `${this.name} found no thumbnail for "${filePath}". Is the Slicer Thumbnails plugin installed and does the gcode file contain a thumbnail?`,
        );

        return this.getFallbackThumbnail();
      }

      // The plugin reports the thumbnail path unencoded and relative to the
      // OctoPrint root. The trailing slash on the base keeps sub paths of
      // reverse proxied instances (e.g. http://host/octoprint) intact.
      return new URL(
        json.thumbnail.replace(/^\/+/, ""),
        this.config.endpoint.replace(/\/+$/, "") + "/",
      ).href;
    } catch (error) {
      Log.error(`${this.name} received an error: ${error}`);
      this.sendSocketNotification("HTTP_ERROR", {});

      return null;
    }
  },

  getFallbackThumbnail() {
    return "./modules/MMM-octoprint/img/no_thumbnail.png";
  },

  getHeaders() {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  },
});
