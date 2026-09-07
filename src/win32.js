/**
 * Windows FFI helpers (koffi) for process attach, memory read, and input.
 * AGPL-3.0-only — see NOTICE / LICENSE (derived from OpenMacro XTernal concepts).
 */
'use strict';

const koffi = require('koffi');

const kernel32 = koffi.load('kernel32.dll');
const psapi = koffi.load('psapi.dll');
const user32 = koffi.load('user32.dll');

const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_VM_READ = 0x0010;
const LIST_MODULES_ALL = 0x03;
const TH32CS_SNAPPROCESS = 0x00000002;
const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const INPUT_KEYBOARD = 1;
const INPUT_SIZE = 40;
const MAPVK_VK_TO_VSC = 0;
const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_OEM_5 = 0xdc; // '\' on US QWERTY — Roblox UI Navigation default
const ASFW_ANY = 0xffffffff;
const SW_SHOW = 5;
const SW_RESTORE = 9;
const GW_CHILD = 5;
const GW_HWNDNEXT = 2;

const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
  dwSize: 'uint32',
  cntUsage: 'uint32',
  th32ProcessID: 'uint32',
  th32DefaultHeapID: 'uintptr',
  th32ModuleID: 'uint32',
  cntThreads: 'uint32',
  th32ParentProcessID: 'uint32',
  pcPriClassBase: 'int32',
  dwFlags: 'uint32',
  szExeFile: koffi.array('char16', 260)
});

const OpenProcess = kernel32.func(
  'uintptr OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)'
);
const CloseHandle = kernel32.func('int CloseHandle(uintptr hObject)');
const ReadProcessMemory = kernel32.func(
  'int ReadProcessMemory(uintptr hProcess, uintptr lpBaseAddress, void *lpBuffer, uintptr nSize, uintptr *lpNumberOfBytesRead)'
);
const CreateToolhelp32Snapshot = kernel32.func(
  'uintptr CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)'
);
const Process32FirstW = kernel32.func('int Process32FirstW(uintptr hSnapshot, void *lppe)');
const Process32NextW = kernel32.func('int Process32NextW(uintptr hSnapshot, void *lppe)');
const GetLastError = kernel32.func('uint32 GetLastError()');
const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()');

const EnumProcessModulesEx = psapi.func(
  'int EnumProcessModulesEx(uintptr hProcess, void *lphModule, uint32 cb, uint32 *lpcbNeeded, uint32 dwFilterFlag)'
);

const mouse_event = user32.func(
  'void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)'
);
const SendInput = user32.func('uint32 SendInput(uint32 cInputs, void *pInputs, int cbSize)');
const MapVirtualKeyW = user32.func('uint32 MapVirtualKeyW(uint32 uCode, uint32 uMapType)');
const SetCursorPos = user32.func('int SetCursorPos(int X, int Y)');
const GetCursorPos = user32.func('int GetCursorPos(void *lpPoint)');
const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)');
const ClientToScreen = user32.func('int ClientToScreen(uintptr hWnd, void *lpPoint)');
const GetWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(uintptr hWnd, uint32 *lpdwProcessId)'
);
const IsWindowVisible = user32.func('int IsWindowVisible(uintptr hWnd)');
const IsIconic = user32.func('int IsIconic(uintptr hWnd)');
const GetClientRect = user32.func('int GetClientRect(uintptr hWnd, void *lpRect)');
const SetForegroundWindow = user32.func('int SetForegroundWindow(uintptr hWnd)');
const GetForegroundWindow = user32.func('uintptr GetForegroundWindow()');
const ShowWindow = user32.func('int ShowWindow(uintptr hWnd, int nCmdShow)');
const BringWindowToTop = user32.func('int BringWindowToTop(uintptr hWnd)');
const GetDesktopWindow = user32.func('uintptr GetDesktopWindow()');
const GetWindow = user32.func('uintptr GetWindow(uintptr hWnd, uint32 uCmd)');
const AttachThreadInput = user32.func(
  'int AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)'
);
const AllowSetForegroundWindow = user32.func('int AllowSetForegroundWindow(uint32 dwProcessId)');

function findProcessIdByName(exeName) {
  const target = String(exeName || '').toLowerCase();
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snap || BigInt(snap) === INVALID_HANDLE_VALUE) {
    throw new Error(`CreateToolhelp32Snapshot failed (${GetLastError()})`);
  }

  try {
    const size = koffi.sizeof(PROCESSENTRY32W);
    const buf = Buffer.alloc(size);
    buf.writeUInt32LE(size, 0);

    if (!Process32FirstW(snap, buf)) return 0;

    do {
      const pid = buf.readUInt32LE(8);
      const name = buf
        .toString('utf16le', 44, 44 + 520)
        .replace(/\0.*$/, '')
        .toLowerCase();
      if (name === target) return pid >>> 0;
    } while (Process32NextW(snap, buf));

    return 0;
  } finally {
    CloseHandle(snap);
  }
}

function openProcessForRead(pid) {
  let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
  if (!handle) {
    handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
  }
  if (!handle) {
    throw new Error(`OpenProcess failed for pid ${pid} (error ${GetLastError()})`);
  }
  return handle;
}

function getMainModuleBase(hProcess) {
  const slotCount = 1024;
  const buf = Buffer.alloc(slotCount * 8);
  const needed = Buffer.alloc(4);
  const ok = EnumProcessModulesEx(hProcess, buf, buf.length, needed, LIST_MODULES_ALL);
  if (!ok) {
    throw new Error(`EnumProcessModulesEx failed (error ${GetLastError()})`);
  }
  return Number(buf.readBigUInt64LE(0));
}

function readBytes(hProcess, address, size) {
  const out = Buffer.alloc(size);
  const read = Buffer.alloc(8);
  const ok = ReadProcessMemory(hProcess, address, out, size, read);
  if (!ok) return null;
  return out;
}

function findBestWindowForPid(pid) {
  let bestHwnd = 0;
  let bestArea = -1;
  let fallbackHwnd = 0;

  const desktop = GetDesktopWindow();
  let hwnd = GetWindow(desktop, GW_CHILD);
  const rectBuf = Buffer.alloc(16);

  while (hwnd) {
    const pidBuf = Buffer.alloc(4);
    GetWindowThreadProcessId(hwnd, pidBuf);
    const windowPid = pidBuf.readUInt32LE(0);

    if (windowPid === pid) {
      const handle = Number(hwnd);
      if (!fallbackHwnd) fallbackHwnd = handle;

      if (IsWindowVisible(hwnd) && GetClientRect(hwnd, rectBuf)) {
        const width = Math.max(0, rectBuf.readInt32LE(8) - rectBuf.readInt32LE(0));
        const height = Math.max(0, rectBuf.readInt32LE(12) - rectBuf.readInt32LE(4));
        const area = width * height;
        if (area > bestArea) {
          bestArea = area;
          bestHwnd = handle;
        }
      }
    }

    hwnd = GetWindow(hwnd, GW_HWNDNEXT);
  }

  return bestHwnd || fallbackHwnd;
}

function focusWindow(hwnd) {
  if (!hwnd) return false;

  try {
    AllowSetForegroundWindow(ASFW_ANY);
  } catch {
    // ignore
  }

  // SW_RESTORE un-maximizes Roblox — only use it when the window is minimized.
  if (IsIconic(hwnd)) {
    ShowWindow(hwnd, SW_RESTORE);
  } else if (!IsWindowVisible(hwnd)) {
    ShowWindow(hwnd, SW_SHOW);
  }

  const foreground = Number(GetForegroundWindow()) || 0;
  const currentThread = GetCurrentThreadId();
  const fgPidBuf = Buffer.alloc(4);
  const targetPidBuf = Buffer.alloc(4);
  const fgThread = foreground ? GetWindowThreadProcessId(foreground, fgPidBuf) : 0;
  const targetThread = GetWindowThreadProcessId(hwnd, targetPidBuf);

  if (fgThread && fgThread !== currentThread) {
    AttachThreadInput(currentThread, fgThread, 1);
  }
  if (targetThread && targetThread !== currentThread && targetThread !== fgThread) {
    AttachThreadInput(currentThread, targetThread, 1);
  }

  BringWindowToTop(hwnd);
  const ok = !!SetForegroundWindow(hwnd);

  if (fgThread && fgThread !== currentThread) {
    AttachThreadInput(currentThread, fgThread, 0);
  }
  if (targetThread && targetThread !== currentThread && targetThread !== fgThread) {
    AttachThreadInput(currentThread, targetThread, 0);
  }

  return ok;
}

function writeKeyboardInput(buf, offset, vk, flags) {
  const scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC) & 0xffff;
  buf.writeUInt32LE(INPUT_KEYBOARD, offset + 0);
  buf.writeUInt32LE(0, offset + 4);
  buf.writeUInt16LE(vk & 0xffff, offset + 8);
  buf.writeUInt16LE(scan, offset + 10);
  // Prefer VK for Enter/OEM keys; include scan for layouts that need it
  buf.writeUInt32LE(flags >>> 0, offset + 12);
  buf.writeUInt32LE(0, offset + 16);
  buf.writeUInt32LE(0, offset + 20);
  buf.writeBigUInt64LE(0n, offset + 24);
}

function tapVirtualKey(vk) {
  const buf = Buffer.alloc(INPUT_SIZE * 2);
  writeKeyboardInput(buf, 0, vk, 0);
  writeKeyboardInput(buf, INPUT_SIZE, vk, KEYEVENTF_KEYUP);
  return SendInput(2, buf, INPUT_SIZE) === 2;
}

function tapEnter() {
  if (tapVirtualKey(VK_RETURN)) return true;
  // Last-resort: synthesize with scan-code style SendInput using only scancode
  const scan = MapVirtualKeyW(VK_RETURN, MAPVK_VK_TO_VSC) & 0xffff;
  const buf = Buffer.alloc(INPUT_SIZE * 2);
  for (const [off, flags] of [
    [0, KEYEVENTF_SCANCODE],
    [INPUT_SIZE, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP]
  ]) {
    buf.writeUInt32LE(INPUT_KEYBOARD, off);
    buf.writeUInt16LE(0, off + 8);
    buf.writeUInt16LE(scan, off + 10);
    buf.writeUInt32LE(flags, off + 12);
  }
  return SendInput(2, buf, INPUT_SIZE) === 2;
}

function tapEscape() {
  return tapVirtualKey(VK_ESCAPE);
}

function tapBackslash() {
  // XTernal: SendInput("\") enables Roblox UI Navigation so Enter activates shake.
  return tapVirtualKey(VK_OEM_5);
}

function mouseLeftDown() {
  mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
}

function mouseLeftUp() {
  mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
}

function mouseRightDown() {
  mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
}

function mouseRightUp() {
  mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
}

function clientToScreen(hwnd, x, y) {
  const pt = Buffer.alloc(8);
  pt.writeInt32LE(x | 0, 0);
  pt.writeInt32LE(y | 0, 4);
  if (!ClientToScreen(hwnd, pt)) return null;
  return { x: pt.readInt32LE(0), y: pt.readInt32LE(4) };
}

function clickScreen(x, y) {
  SetCursorPos(Math.round(x), Math.round(y));
  mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  return true;
}

function clickClient(hwnd, clientX, clientY) {
  if (!hwnd) return false;
  const screen = clientToScreen(hwnd, clientX, clientY);
  if (!screen) return false;
  focusWindow(hwnd);
  return clickScreen(screen.x, screen.y);
}

function getCursorPos() {
  const pt = Buffer.alloc(8);
  if (!GetCursorPos(pt)) return null;
  return { x: pt.readInt32LE(0), y: pt.readInt32LE(4) };
}

function isKeyDown(vk) {
  return (GetAsyncKeyState(vk) & 0x8000) !== 0;
}

function sleepSync(ms) {
  const end = Date.now() + Math.max(0, ms);
  while (Date.now() < end) {
    // busy wait — short only
  }
}

/** XTernal ReliableScreenClick — wiggle then click at screen coords. */
function reliableScreenClick(x, y, wigglePixels = 3, stepDelayMs = 15) {
  x = Math.round(x);
  y = Math.round(y);
  const w = Math.max(1, Math.round(wigglePixels));
  const steps = [
    [x, y],
    [x + w, y],
    [x - w, y],
    [x, y + w],
    [x, y - w],
    [x, y]
  ];
  for (const [sx, sy] of steps) {
    SetCursorPos(sx, sy);
    sleepSync(stepDelayMs);
  }
  mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  return true;
}

function tapCharKey(ch) {
  const c = String(ch || '').toUpperCase();
  if (!c) return false;
  const code = c.charCodeAt(0);
  if (code >= 0x41 && code <= 0x5a) return tapVirtualKey(code);
  if (code >= 0x30 && code <= 0x39) return tapVirtualKey(code);
  return false;
}

module.exports = {
  findProcessIdByName,
  openProcessForRead,
  getMainModuleBase,
  readBytes,
  closeHandle: CloseHandle,
  findBestWindowForPid,
  focusWindow,
  getForegroundWindow: GetForegroundWindow,
  mouseLeftDown,
  mouseLeftUp,
  mouseRightDown,
  mouseRightUp,
  tapEnter,
  tapEscape,
  tapBackslash,
  tapVirtualKey,
  tapCharKey,
  clientToScreen,
  clickScreen,
  clickClient,
  getCursorPos,
  isKeyDown,
  reliableScreenClick,
  VK_RBUTTON: 0x02,
  ROBLOX_EXE: 'RobloxPlayerBeta.exe'
};
