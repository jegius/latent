//! Манифест проекта для WASM C-ABI (web IDE).
//!
//! Формат (little-endian):
//! ```text
//! magic "LPF1" (4 bytes)
//! u32 file_count
//! file_count × { u32 path_len, path utf8, u32 src_len, src utf8 }
//! u32 entry_index
//! ```
//! Кодирование/декодирование — чистые функции, без зависимостей.

use super::loader::SourceFile;

/// Магия формата манифеста.
pub const MAGIC: &[u8; 4] = b"LPF1";

/// Кодирует проект в формат `LPF1`.
pub fn encode(files: &[SourceFile], entry_index: usize) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(files.len() as u32).to_le_bytes());
    for file in files {
        out.extend_from_slice(&(file.path.len() as u32).to_le_bytes());
        out.extend_from_slice(file.path.as_bytes());
        out.extend_from_slice(&(file.text.len() as u32).to_le_bytes());
        out.extend_from_slice(file.text.as_bytes());
    }
    out.extend_from_slice(&(entry_index as u32).to_le_bytes());
    out
}

fn read_u32(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    if *offset + 4 > bytes.len() {
        return Err("LPF1: неожиданный конец манифеста".to_string());
    }
    let value = u32::from_le_bytes([
        bytes[*offset],
        bytes[*offset + 1],
        bytes[*offset + 2],
        bytes[*offset + 3],
    ]);
    *offset += 4;
    Ok(value)
}

fn read_str(bytes: &[u8], offset: &mut usize, len: u32) -> Result<String, String> {
    let len = len as usize;
    if *offset + len > bytes.len() {
        return Err("LPF1: неожиданный конец манифеста (строка)".to_string());
    }
    let text = std::str::from_utf8(&bytes[*offset..*offset + len])
        .map_err(|_| "LPF1: путь/исходник не является UTF-8".to_string())?;
    *offset += len;
    Ok(text.to_string())
}

/// Декодирует `LPF1`: возвращает файлы и канонический путь entry.
pub fn decode(bytes: &[u8]) -> Result<(Vec<SourceFile>, String), String> {
    if bytes.len() < 8 {
        return Err("LPF1: манифест слишком короткий".to_string());
    }
    if &bytes[0..4] != MAGIC {
        return Err("LPF1: неверная магия (ожидалось 'LPF1')".to_string());
    }
    let mut offset = 4;
    let count = read_u32(bytes, &mut offset)? as usize;
    let mut files = Vec::with_capacity(count);
    for _ in 0..count {
        let path_len = read_u32(bytes, &mut offset)?;
        let path = read_str(bytes, &mut offset, path_len)?;
        let src_len = read_u32(bytes, &mut offset)?;
        let text = read_str(bytes, &mut offset, src_len)?;
        files.push(SourceFile { path, text });
    }
    let entry_index = read_u32(bytes, &mut offset)? as usize;
    if files.is_empty() {
        return Err("LPF1: манифест без файлов".to_string());
    }
    let entry = files
        .get(entry_index)
        .ok_or_else(|| format!("LPF1: entry_index {} вне диапазона файлов", entry_index))?
        .path
        .clone();
    Ok((files, entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<SourceFile> {
        vec![
            SourceFile::new("main.lat", "import { a } from \"./a.lat\";\nfn main() -> int { return a(); }"),
            SourceFile::new("a.lat", "export fn a() -> int { return 7; }"),
        ]
    }

    #[test]
    fn roundtrip() {
        let files = sample();
        let bytes = encode(&files, 0);
        let (decoded, entry) = decode(&bytes).unwrap();
        assert_eq!(decoded, files);
        assert_eq!(entry, "main.lat");
    }

    #[test]
    fn bad_magic() {
        let mut bytes = encode(&sample(), 0);
        bytes[0] = b'X';
        assert!(decode(&bytes).unwrap_err().contains("магия"));
    }

    #[test]
    fn truncated() {
        let bytes = encode(&sample(), 0);
        assert!(decode(&bytes[..bytes.len() - 3]).is_err());
    }

    #[test]
    fn entry_out_of_range() {
        let bytes = encode(&sample(), 9);
        assert!(decode(&bytes).unwrap_err().contains("entry_index"));
    }

    #[test]
    fn empty_manifest() {
        let bytes = encode(&[], 0);
        assert!(decode(&bytes).unwrap_err().contains("без файлов"));
    }

    #[test]
    fn bad_utf8_in_path() {
        let mut bytes = encode(&sample(), 0);
        // magic(4) + count(4) + path_len(4), затем path "main.lat".
        bytes[12] = 0xFF;
        assert!(decode(&bytes).unwrap_err().contains("UTF-8"));
    }

    #[test]
    fn every_truncated_prefix_is_error() {
        let bytes = encode(&sample(), 0);
        for len in 0..bytes.len() {
            assert!(decode(&bytes[..len]).is_err(), "len={len}");
        }
    }
}
