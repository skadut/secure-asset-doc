# FICTIONAL SIMULATION DATA. Not an official TNI document. Generates Indonesian sample spreadsheets.
import random
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter

NOTICE = "SIMULASI DEMO - BUKAN DOKUMEN RESMI TNI"
OUT = Path(__file__).resolve().parent.parent / "public" / "samples"
OUT.mkdir(parents=True, exist_ok=True)
BASES = ["Simulasi Pangkalan Halim", "Simulasi Pos Merapi", "Simulasi Stasiun Samudra", "Simulasi Lanud Cakrawala", "Simulasi Gudang Nusantara"]
random.seed(1)
FIRST = ["Arga", "Nadia", "Bima", "Sari", "Raka", "Intan", "Dimas", "Ayu", "Fajar", "Laras", "Eka", "Rini", "Bagas", "Maya", "Tegar", "Nisa", "Rizky", "Citra", "Bayu", "Dewi"]
LAST = ["Pratama", "Wijaya", "Saputra", "Lestari", "Kusuma", "Permana", "Utami", "Hidayat", "Putri", "Wibowo", "Nugraha", "Siregar", "Maulana", "Pertiwi", "Santoso", "Rahmawati", "Firmansyah", "Anggraini", "Setiawan", "Amalia"]
RANKS = ["Prajurit", "Kopral", "Sersan", "Letnan", "Kapten", "Mayor"]
UNITS = ["Tim Sandi Simulasi", "Detasemen Logistik Simulasi", "Pleton Zeni Simulasi", "Regu Pengamanan Simulasi", "Kompi Pemeliharaan Simulasi", "Tim Medis Simulasi"]
STATUS = ["Aktif (simulasi)", "Cuti (simulasi)", "Latihan (simulasi)"]

def date_str(i):
    return f"2026-{(i % 9) + 1:02d}-{(i * 3) % 27 + 1:02d}"

def sheet(wb, title, headers, rows, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title
    ws.cell(row=1, column=1, value=NOTICE).font = Font(bold=True, color="9C0006")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=2, column=c, value=h)
        cell.font = Font(bold=True)
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    for r in rows: ws.append(r)
    for c, h in enumerate(headers, 1):
        width = max([len(str(h))] + [len(str(r[c - 1])) for r in rows]) + 2
        ws.column_dimensions[get_column_letter(c)].width = min(max(width, 10), 40)
    ws.freeze_panes = "A3"
    return ws

# personnel-roster.xlsx: 40 fabricated, non-identifying demo entries.
wb = Workbook()
roster = []
for i in range(40):
    roster.append([f"DEMO-{i + 1:04d}", RANKS[min(i * 7 % 17 // 3, 5)], LAST[i % len(LAST)], FIRST[(i * 7) % len(FIRST)],
        UNITS[i % len(UNITS)], BASES[i % len(BASES)], "Simulasi", STATUS[(i * 11) % 3], date_str(i)])
sheet(wb, "Roster", ["Nomor Demo", "Pangkat Simulasi", "Nama Belakang", "Nama Depan", "Unit Simulasi", "Lokasi Simulasi", "Kategori Demo", "Status Demo", "Tanggal Laporan"], roster, first=True)
wb.save(OUT / "personnel-roster.xlsx")

# installation-register.xlsx
wb = Workbook()
bases = [
 ["DEMO-B01", BASES[0], "Pangkalan Simulasi", "Wilayah Simulasi Utara", "Perwira Simulasi A", 1850, "Generator demo dan jaringan umum", "Sumber air demo", "ZONA-DEMO-01"],
 ["DEMO-B02", BASES[1], "Pos Simulasi", "Wilayah Simulasi Pegunungan", "Perwira Simulasi B", 1200, "Jaringan demo dan surya", "Sumur demo", "ZONA-DEMO-02"],
 ["DEMO-B03", BASES[2], "Stasiun Simulasi", "Wilayah Simulasi Pesisir", "Perwira Simulasi C", 2400, "Jaringan demo", "Unit air demo", "ZONA-DEMO-03"],
 ["DEMO-B04", BASES[3], "Lanud Simulasi", "Wilayah Simulasi Tengah", "Perwira Simulasi D", 3100, "Jaringan demo", "Pasokan air demo", "ZONA-DEMO-04"],
 ["DEMO-B05", BASES[4], "Gudang Simulasi", "Wilayah Simulasi Tengah", "Perwira Simulasi E", 640, "Generator demo", "Unit pemurnian demo", "ZONA-DEMO-05"],
]
sheet(wb, "Bases", ["Kode Demo", "Nama Lokasi Simulasi", "Jenis", "Wilayah Demo", "Penanggung Jawab Simulasi", "Personel Demo", "Sumber Daya Demo", "Sumber Air Demo", "Zona Jaringan Demo"], bases, first=True)
fac_types = [("Instalasi air simulasi", "Tinggi"), ("Gardu simulasi", "Tinggi"), ("Penyimpanan BBM simulasi", "Tinggi"), ("Menara relai simulasi", "Sedang"), ("Area cuci kendaraan demo", "Rendah"), ("Pusat kendali simulasi", "Tinggi"), ("Pool kendaraan demo", "Rendah"), ("Gudang logistik demo", "Sedang"), ("Rumah generator demo", "Tinggi"), ("Klinik simulasi", "Tinggi"), ("Sensor perimeter demo", "Sedang"), ("Stasiun pompa demo", "Tinggi"), ("Pertukaran sinyal demo", "Tinggi"), ("Kontrol hanggar demo", "Sedang"), ("Kontrol derek dermaga demo", "Sedang")]
facilities = [[BASES[i % 5], name, ["Kontrol PLC simulasi", "SCADA simulasi", "Otomasi gedung demo", "Telemetri radio simulasi"][i % 4], crit] for i, (name, crit) in enumerate(fac_types)]
sheet(wb, "Facilities", ["Lokasi Simulasi", "Fasilitas Demo", "Sistem OT Demo", "Kritikalitas Demo"], facilities)
wb.save(OUT / "installation-register.xlsx")

# equipment-register.xlsx; preserve sheet keys and row counts.
wb = Workbook()
VEH = ["Kendaraan utilitas demo", "Truk kargo simulasi", "Truk tangki demo", "Ambulans simulasi", "Forklift demo 3 ton", "Minibus simulasi"]
COMMS = ["Radio lapangan demo", "Terminal satelit simulasi", "Node jaringan demo", "Perangkat relai simulasi", "Radio genggam demo"]
PW = ["Generator diesel demo 60 kW", "Unit pemurnian air simulasi", "Pengendali surya demo", "UPS demo 10 kVA", "Pompa BBM demo", "Bank baterai simulasi"]
def eq_rows(items, cat, start, n):
    return [[f"DEMO-{start + i:04d}", cat, items[i % len(items)], BASES[i % 5], f"SIM-{(start + i) * 37 % 9000 + 1000:04d}",
        ["Beroperasi (demo)", "Beroperasi (demo)", "Pemeliharaan (demo)", "Siaga (demo)"][i % 4], date_str(i + 3)] for i in range(n)]
hdr = ["Kode Aset", "Kategori Demo", "Uraian Demo", "Lokasi Simulasi", "Nomor Seri Demo", "Status Demo", "Pemeriksaan Terakhir"]
sheet(wb, "Vehicles", hdr, eq_rows(VEH, "Kendaraan demo", 1, 20), first=True)
sheet(wb, "Comms", hdr, eq_rows(COMMS, "Komunikasi demo", 21, 15))
sheet(wb, "Power & Water", hdr, eq_rows(PW, "Daya dan air demo", 36, 12))
wb.save(OUT / "equipment-register.xlsx")
print("xlsx ok")
