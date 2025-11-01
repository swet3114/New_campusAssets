// src/components/Scan.jsx
import { useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner, Html5Qrcode } from "html5-qrcode";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

const API = "http://localhost:5000";

const STATUS_OPTIONS = ["Active", "Inactive", "Repair", "Scrape", "Damage"];
const ASSIGNED_TYPE_OPTIONS = ["general", "individual"];
const REG_RE = /^[A-Za-z0-9_-]+\/\d{14}\/\d{5,15}$/;
const BULK_RE = /^[A-Z]{2,20}\/[A-Z]{2,20}\/\d{14}\/\d{4}$/;

export default function Scan() {
  const navigate = useNavigate();

  const [mode, setMode] = useState(null); // "bulk" | "single" | null
  const [scannedText, setScannedText] = useState("");
  const [asset, setAsset] = useState(null);
  const [qrDoc, setQrDoc] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Unified form aligned with AssetForm field list and alignment
  const [form, setForm] = useState({
    // Top: organization + identity
    institute: "",
    department: "",
    asset_name: "",
    category: "",

    // Row 1 (AssetForm): core details
    status: "active",
    size_lxwxh: "",
    company_model: "",
    it_serial_no: "",
    dead_stock_no: "",

    // Row 2 (AssetForm): procurement
    bill_no: "",
    vendor_name: "",
    purchase_date: "",
    rate_per_unit: "",
    po_no: "",

    // Row 3 (AssetForm): location + desc
    room_no: "",
    building_name: "",
    desc: "",

    // Row 4 (AssetForm): assignment
    assigned_type: "general",
    assigned_faculty_name: "",
    employee_code: "",
    assign_date: "",

    // Row 5 (AssetForm): remarks
    remarks: "",

    // Extra carried fields
    location: "",

    // Verification (kept at end)
    verification_date: "",
    verified: false,
    verified_by: "",
  });

  const needsFaculty = form.assigned_type === "individual";

  const scannerRef = useRef(null);
  const fileQrRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const initScanner = () => {
      const config = { fps: 10, qrbox: 250, rememberLastUsedCamera: true };
      const scanner = new Html5QrcodeScanner("qr-reader", config, false);

      const onSuccess = async (decodedText) => {
        try {
          await scanner.clear();
        } catch {}
        handleDecodedText(decodedText);
      };

      const onError = () => {};

      scanner.render(onSuccess, onError);
      scannerRef.current = scanner;
    };

    initScanner();
    fileQrRef.current = new Html5Qrcode("qr-reader-file-canvas", { verbose: false });

    return () => {
      (async () => {
        try {
          await scannerRef.current?.clear();
        } catch {}
        try {
          if (fileQrRef.current?.isScanning) await fileQrRef.current.stop();
          await fileQrRef.current?.clear();
        } catch {}
      })();
    };
  }, []);

  // Map backend doc to the AssetForm sequence
  const fillFormFromDoc = (doc) => {
    const assignedType = (doc.assigned_type || "general").toLowerCase();
    setForm({
      institute: doc.institute || "",
      department: doc.department || "",
      asset_name: doc.asset_name || "",
      category: doc.category || "",

      status: doc.status || "active",
      size_lxwxh: doc.size_lxwxh || "",
      company_model: doc.company_model || "",
      it_serial_no: doc.it_serial_no || "",
      dead_stock_no: doc.dead_stock_no || "",

      bill_no: doc.bill_no || "",
      vendor_name: doc.vendor_name || "",
      purchase_date: doc.purchase_date || "",
      rate_per_unit: doc.rate_per_unit != null ? String(doc.rate_per_unit) : "",
      po_no: doc.po_no || "",

      room_no: doc.room_no || "",
      building_name: doc.building_name || "",
      desc: doc.desc || "",

      assigned_type: assignedType,
      assigned_faculty_name: assignedType === "individual" ? doc.assigned_faculty_name || "" : "",
      employee_code: assignedType === "individual" ? doc.employee_code || "" : "",
      assign_date: doc.assign_date || "",

      remarks: doc.remarks || "",

      location: doc.location || "",

      verification_date: doc.verification_date || "",
      verified: !!doc.verified,
      verified_by: doc.verified_by || "",
    });
  };

  const handleDecodedText = async (text) => {
    setStatusMsg(null);
    setMode(null);
    setAsset(null);
    setQrDoc(null);
    setScannedText("");

    const t = (text || "").trim();
    if (!t) {
      setStatusMsg({ ok: false, msg: "Invalid QR" });
      return;
    }

    if (BULK_RE.test(t)) {
      try {
        const res = await fetch(`${API}/api/qr/by-id/${encodeURIComponent(t)}`, { credentials: "include" });
        if (res.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        if (res.ok) {
          const qr = await res.json();
          setMode("bulk");
          setQrDoc(qr);
          setScannedText(t);
          fillFormFromDoc(qr);
          return;
        }
        setStatusMsg({ ok: false, msg: "QR not found" });
        return;
      } catch {
        setStatusMsg({ ok: false, msg: "Network error" });
        return;
      }
    }

    if (!REG_RE.test(t)) {
      setStatusMsg({ ok: false, msg: "Data not found" });
      return;
    }
    setScannedText(t);
    try {
      const encoded = encodeURIComponent(t);
      const res = await fetch(`${API}/api/assets/by-reg/${encoded}`, { credentials: "include" });
      if (res.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      if (!res.ok) {
        setStatusMsg({ ok: false, msg: "Not found" });
        return;
      }
      const data = await res.json();
      setMode("single");
      setAsset(data);
      fillFormFromDoc(data);
    } catch {
      setStatusMsg({ ok: false, msg: "Network error" });
    }
  };

  const restartScanner = async () => {
    setMode(null);
    setScannedText("");
    setAsset(null);
    setQrDoc(null);
    setStatusMsg(null);

    try {
      await scannerRef.current?.clear();
    } catch {}

    const el = document.getElementById("qr-reader");
    if (el) while (el.firstChild) el.removeChild(el.firstChild);

    const config = { fps: 10, qrbox: 250, rememberLastUsedCamera: true };
    const scanner = new Html5QrcodeScanner("qr-reader", config, false);
    scanner.render(
      async (decodedText) => {
        try {
          await scanner.clear();
        } catch {}
        handleDecodedText(decodedText);
      },
      () => {}
    );
    scannerRef.current = scanner;
  };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMsg(null);
    try {
      const result = await fileQrRef.current.scanFile(file, true);
      await fileQrRef.current.clear();
      handleDecodedText(result);
    } catch {
      setStatusMsg({ ok: false, msg: "Unable to read QR from image" });
    } finally {
      e.target.value = "";
    }
  };

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => {
      if (name === "assigned_type") {
        const nextType = value;
        return {
          ...f,
          assigned_type: nextType,
          assigned_faculty_name: nextType === "general" ? "" : f.assigned_faculty_name,
          employee_code: nextType === "general" ? "" : f.employee_code,
        };
      }
      if (type === "checkbox" && name === "verified") {
        return { ...f, verified: !!checked };
      }
      if (name === "rate_per_unit") {
        const onlyDigitsDot = value.replace(/[^\d.]/g, "");
        return { ...f, rate_per_unit: onlyDigitsDot };
      }
      return { ...f, [name]: value };
    });
  };

  const onSave = async (e) => {
    e.preventDefault();
    setStatusMsg(null);

    const payload = {
      // Top
      institute: form.institute,
      department: form.department,
      asset_name: form.asset_name,
      category: form.category,

      // Row 1
      status: form.status,
      size_lxwxh: form.size_lxwxh,
      company_model: form.company_model,
      it_serial_no: form.it_serial_no,
      dead_stock_no: form.dead_stock_no,

      // Row 2
      bill_no: form.bill_no,
      vendor_name: form.vendor_name,
      purchase_date: form.purchase_date,
      rate_per_unit: form.rate_per_unit,
      po_no: form.po_no,

      // Row 3
      room_no: form.room_no,
      building_name: form.building_name,
      desc: form.desc,

      // Row 4
      assigned_type: form.assigned_type,
      assigned_faculty_name: needsFaculty ? form.assigned_faculty_name : "",
      employee_code: needsFaculty ? form.employee_code : "",
      assign_date: form.assign_date,

      // Row 5
      remarks: form.remarks,

      // Extra carried fields
      location: form.location,

      // Verification (persisted in both modes)
      verified: !!form.verified,
      verified_by: form.verified_by,
    };

    try {
      if (mode === "bulk" && qrDoc?.qr_id) {
        const res = await fetch(`${API}/api/qr/${encodeURIComponent(qrDoc.qr_id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatusMsg({ ok: false, msg: data.error || "Failed to save" });
        } else {
          setStatusMsg({ ok: true, msg: "Saved to QR registry" });
          setQrDoc(data);
          setForm((f) => ({ ...f, verification_date: data.verification_date || f.verification_date }));
        }
      } else if (mode === "single" && asset?._id) {
        const res = await fetch(`${API}/api/assets/${asset._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatusMsg({ ok: false, msg: data.error || "Failed to update" });
        } else {
          setStatusMsg({ ok: true, msg: "Updated successfully" });
          setAsset((a) => a && { ...a, ...payload, verification_date: data.verification_date || a.verification_date });
          setForm((f) => ({ ...f, verification_date: data.verification_date || f.verification_date }));
        }
      }
    } catch {
      setStatusMsg({ ok: false, msg: "Network error" });
    }
  };

  // --- BULK IMPORT HANDLER (unchanged content) ---
  const handleImportExcel = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMsg(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        let rows = XLSX.utils.sheet_to_json(ws);

        rows = rows.map((row) => {
          const out = {};
          for (const k in row) {
            const cleanKey = String(k).replace(/^\uFEFF/, "").trim();
            let val = row[k];
            if (typeof val === "string") val = val.replace(/^\uFEFF/, "").trim();
            out[cleanKey] = val;
          }
          return out;
        });

        const filteredRows = rows.filter((r) => (r.verified_by || "").trim());

        if (filteredRows.length) {
          const isBulk = filteredRows.every((r) => /^[A-Za-z]/.test(String(r.serial_no || "")));

          if (isBulk) {
            const res = await fetch(`${API}/api/assets/bulk-update-by-serial}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify(filteredRows),
            });
            const data = await res.json();
            if (!res.ok) setStatusMsg({ ok: false, msg: data.error || "Bulk update failed" });
            else setStatusMsg({ ok: true, msg: `Bulk update complete. Updated: ${data.updated?.length || 0}` });
          } else {
            let success = 0,
              failure = 0;
            for (const row of filteredRows) {
              if (/^\d+$/.test(String(row.serial_no || ""))) {
                const res = await fetch(`${API}/api/assets/single-import`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify(row),
                });
                if (res.ok) success++;
                else failure++;
              }
            }
            setStatusMsg({
              ok: failure === 0,
              msg: `Single asset update: Updated ${success}, failed ${failure}`,
            });
          }
        }
      } catch {
        setStatusMsg({ ok: false, msg: "Bulk/single import failed" });
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Match AssetForm container width */}
      <div className="bg-white rounded shadow p-4">
        <h2 className="text-xl font-semibold mb-3">Scan QR</h2>
        <div id="qr-reader" className="w-full max-w-md" />
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-600">Scanned: {scannedText || "-"}</span>
          <button
            onClick={restartScanner}
            className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200"
            type="button"
          >
            Scan
          </button>
          <label className="text-sm text-gray-600">
            or upload image:
            <input type="file" accept="image/*" onChange={onFileChange} className="ml-2 text-sm" />
          </label>
        </div>
        {statusMsg && !statusMsg.ok && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
            {statusMsg.msg}
          </div>
        )}
        <div id="qr-reader-file-canvas" style={{ display: "none" }} />
      </div>

      <div className="bg-white rounded shadow p-4">
        <h3 className="text-lg font-semibold mb-3">
          {mode === "bulk" ? "Bulk QR Details (QR Registry)" : mode === "single" ? "Asset Details" : "Details"}
        </h3>

        {!(mode === "bulk" || mode === "single") ? (
          <p className="text-gray-600 text-sm">
            Scan a QR code or upload an image; bulk QRs will load editable fields from the QR registry, single-asset
            QRs will load the asset record.
          </p>
        ) : (
          <form onSubmit={onSave} className="space-y-6">
            {/* Institute / Department */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">Institute</label>
                <input 
                  className="w-full border rounded px-3 py-2"
                  name="institute"
                  value={form.institute}
                  onChange={onChange}
                  placeholder="Select Institute"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Department</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="department"
                  value={form.department}
                  onChange={onChange}
                  placeholder="Select Department"
                />
              </div>
            </div>

            {/* Asset Name / Category */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">Asset Name</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="asset_name"
                  value={form.asset_name}
                  onChange={onChange}
                  placeholder="Asset Name"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Category</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="category"
                  value={form.category}
                  onChange={onChange}
                  placeholder="Category"
                />
              </div>
            </div>

            {/* Row 1: 1–5 */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm mb-1">Status</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  name="status"
                  value={form.status}
                  onChange={onChange}
                  required
                >
                  <option value="" >
                    Select Status
                  </option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1">Design Specifications (LxWxH)</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="size_lxwxh"
                  value={form.size_lxwxh}
                  onChange={onChange}
                  placeholder="e.g., 30x20x10 cm"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Company / Model / Model No.</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="company_model"
                  value={form.company_model}
                  onChange={onChange}
                  placeholder="e.g., Dell Latitude 5420"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Serial No. (IT Asset)</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="it_serial_no"
                  value={form.it_serial_no}
                  onChange={onChange}
                  placeholder="Device Serial Number"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Dead Stock / Asset / Stock No.</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="dead_stock_no"
                  value={form.dead_stock_no}
                  onChange={onChange}
                  placeholder="Inventory Ledger No."
                />
              </div>
            </div>

            {/* Row 2: 6–10 */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm mb-1">Bill No.</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="bill_no"
                  value={form.bill_no}
                  onChange={onChange}
                  placeholder="Bill Number"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Vendor Name</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="vendor_name"
                  value={form.vendor_name}
                  onChange={onChange}
                  placeholder="Supplier / Seller"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Date of Purchase</label>
                <input
                  type="date"
                  className="w-full border rounded px-3 py-2"
                  name="purchase_date"
                  value={form.purchase_date}
                  onChange={onChange}
                  placeholder="dd-mm-yyyy"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Rate per Unit (Rs.)</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="rate_per_unit"
                  value={form.rate_per_unit}
                  onChange={onChange}
                  inputMode="decimal"
                  placeholder="e.g., 12500.00"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Purchase Order (PO) No.</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="po_no"
                  value={form.po_no}
                  onChange={onChange}
                  placeholder="PO Reference"
                />
              </div>
            </div>

            {/* Row 3: 11–12 + Description */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm mb-1">Room No. / Location (short)</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="room_no"
                  value={form.room_no}
                  onChange={onChange}
                  placeholder="Lab-101"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Name of Building</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="building_name"
                  value={form.building_name}
                  onChange={onChange}
                  placeholder="Main Academic Block"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Description</label>
                <textarea
                  className="w-full border rounded px-3 py-2 h-[42px] lg:h-auto"
                  name="desc"
                  value={form.desc}
                  onChange={onChange}
                  rows={1}
                  placeholder="Model, specs, condition..."
                />
              </div>
            </div>

            {/* Row 4: 13–16 */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm mb-1">Assigned Type</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  name="assigned_type"
                  value={form.assigned_type}
                  onChange={onChange}
                  required
                >
                  <option value="" >
                    Select Assigned Type
                  </option>
                  {ASSIGNED_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1">Assigned To (Employee Name)</label>
                <input
                  className={`w-full border rounded px-3 py-2 ${form.assigned_type !== "individual" ? "bg-gray-50" : ""}`}
                  name="assigned_faculty_name"
                  value={form.assigned_faculty_name}
                  onChange={onChange}
                  placeholder="Dr. A B"
                  disabled={form.assigned_type !== "individual"}
                  required={form.assigned_type === "individual"}
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Assigned To (Employee Code)</label>
                <input
                  className={`w-full border rounded px-3 py-2 ${form.assigned_type !== "individual" ? "bg-gray-50" : ""}`}
                  name="employee_code"
                  value={form.employee_code}
                  onChange={onChange}
                  placeholder="Employee Code"
                  disabled={form.assigned_type !== "individual"}
                  required={form.assigned_type === "individual"}
                />
              </div>

              <div>
                <label className="block text-sm mb-1">Assign Date</label>
                <input
                  type="date"
                  className="w-full border rounded px-3 py-2"
                  name="assign_date"
                  value={form.assign_date}
                  onChange={onChange}
                  placeholder="dd-mm-yyyy"
                />
              </div>
            </div>

            {/* Row 5: Remarks */}
            <div>
              <label className="block text-sm mb-1">Remarks</label>
              <textarea
                className="w-full border rounded px-3 py-2"
                name="remarks"
                value={form.remarks}
                onChange={onChange}
                rows={3}
                placeholder="Any additional notes or remarks"
              />
            </div>

            {/* Verification (kept at end, outside AssetForm rows) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" name="verified" checked={!!form.verified} onChange={onChange} />
                  Verified
                </label>
                {form.verification_date ? (
                  <p className="text-xs text-gray-500 mt-1">Last verification: {form.verification_date}</p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm mb-1">Verified By</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  name="verified_by"
                  value={form.verified_by}
                  onChange={onChange}
                />
              </div>
            </div>

            <div className="text-sm text-gray-600">
              {mode === "single" ? <>Registration Number: {asset?.registration_number}</> : <>QR ID: {qrDoc?.qr_id}</>}
            </div>

            <div className="flex gap-3">
              <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">
                Save Changes
              </button>
              <button
                type="button"
                onClick={restartScanner}
                className="bg-gray-100 px-4 py-2 rounded hover:bg-gray-200"
              >
                Scan Another
              </button>
            </div>
          </form>
        )}
        {statusMsg && statusMsg.ok && <p className="mt-3 text-sm text-green-600">{statusMsg.msg}</p>}
      </div>

      {/* --- BULK IMPORT SECTION --- */}
      <div className="bg-white rounded shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Asset Data Import</h3>
        <p className="text-sm text-gray-600 mb-2">
          Import an Excel file to update one or multiple assets by serial number. The file must include a <b>serial_no</b>{" "}
          column and a <b>verified_by</b> column. Only rows with a filled <b>verified_by</b> will be updated.
        </p>
        <input type="file" accept=".xlsx,.xls" onChange={handleImportExcel} className="mb-2" />
        <p className="text-xs text-gray-500">
          Example columns: serial_no, asset_name, category, location, assign_date, status, desc, institute, department,
          assigned_type, assigned_faculty_name, verified_by.
        </p>
      </div>
    </div>
  );
}
