/**
 * Roblox instance memory readers.
 * AGPL-3.0-only — see NOTICE / LICENSE (ported from OpenMacro XTernal Read.ahk concepts).
 */
'use strict';

const win32 = require('./win32');

function isValidUserPointer(val) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0x10000 && n <= 0x00007fffffffffff;
}

class MemorySession {
  constructor() {
    this.hProcess = 0;
    this.base = 0;
    this.pid = 0;
    this.offsets = Object.create(null);
  }

  attach(pid, base, offsets) {
    this.detach();
    this.pid = pid;
    this.hProcess = win32.openProcessForRead(pid);
    this.base = base || win32.getMainModuleBase(this.hProcess);
    this.offsets = offsets || Object.create(null);
  }

  detach() {
    if (this.hProcess) {
      try {
        win32.closeHandle(this.hProcess);
      } catch {
        // ignore
      }
    }
    this.hProcess = 0;
    this.base = 0;
    this.pid = 0;
  }

  get ready() {
    return !!(this.hProcess && this.base && this.offsets.FakeDataModelPointer);
  }

  readBytes(address, size) {
    if (!this.hProcess) return null;
    return win32.readBytes(this.hProcess, Number(address), size);
  }

  readPointer(address) {
    const buf = this.readBytes(address, 8);
    if (!buf) return 0;
    return Number(buf.readBigUInt64LE(0));
  }

  readInt(address) {
    const buf = this.readBytes(address, 4);
    if (!buf) return 0;
    return buf.readInt32LE(0);
  }

  readByte(address) {
    const buf = this.readBytes(address, 1);
    if (!buf) return 0;
    return buf.readUInt8(0);
  }

  readFloat(address) {
    const buf = this.readBytes(address, 4);
    if (!buf) return 0;
    return buf.readFloatLE(0);
  }

  readString(address) {
    const length = this.readInt(Number(address) + (this.offsets.StringLength || 0x10));
    if (length <= 0 || length > 1000) return '';

    let dataAddr = Number(address);
    if (length > 15) {
      dataAddr = this.readPointer(address);
      if (!dataAddr) return '';
    }

    const buf = this.readBytes(dataAddr, length);
    if (!buf) return '';
    return buf.toString('utf8').replace(/\0+$/, '');
  }

  readInstanceName(instanceAddr) {
    const o = this.offsets;
    if (!instanceAddr) return '<null>';

    if (o.NameContainer != null && o.Name != null) {
      const container = this.readPointer(Number(instanceAddr) + o.NameContainer);
      if (container) {
        const containerName = this.readString(container + o.Name);
        if (containerName) return containerName;
      }
    }

    const namePtr = this.readPointer(Number(instanceAddr) + (o.Name || 0));
    if (!namePtr) return '<null>';
    return this.readString(namePtr);
  }

  readClassName(instanceAddr) {
    const o = this.offsets;
    const classDesc = this.readPointer(Number(instanceAddr) + (o.ClassDescriptor || 0));
    if (!classDesc) return '<unknown>';
    const classNamePtr = this.readPointer(classDesc + (o.ClassDescriptorToClassName || 0));
    if (!classNamePtr) return '<unknown>';
    return this.readString(classNamePtr);
  }

  readChildren(instanceAddr) {
    const children = [];
    const listPtr = this.readPointer(Number(instanceAddr) + (this.offsets.Children || 0));
    if (!listPtr) return children;

    const arrayStart = this.readPointer(listPtr);
    const arrayEnd = this.readPointer(listPtr + 8);
    if (!arrayStart || !arrayEnd || arrayEnd <= arrayStart) return children;

    const entrySize = 0x10;
    const numChildren = Math.floor((arrayEnd - arrayStart) / entrySize);
    if (numChildren < 0 || numChildren > 1000) return children;

    let current = arrayStart;
    for (let i = 0; i < numChildren; i++) {
      const child = this.readPointer(current);
      if (child) children.push(child);
      current += entrySize;
    }
    return children;
  }

  findChildByName(instanceAddr, name) {
    for (const child of this.readChildren(instanceAddr)) {
      if (this.readInstanceName(child) === name) return child;
    }
    return 0;
  }

  findChildByClass(instanceAddr, className) {
    for (const child of this.readChildren(instanceAddr)) {
      if (this.readClassName(child) === className) return child;
    }
    return 0;
  }

  readGuiText(instanceAddr) {
    const keys = ['TextLabelText', 'Text', 'ContentText'];
    for (const key of keys) {
      const offset = this.offsets[key];
      if (offset == null) continue;

      const ptrValue = this.readPointer(Number(instanceAddr) + offset);
      if (ptrValue) {
        const text = this.readString(ptrValue);
        if (text) return text;
      }

      const direct = this.readString(Number(instanceAddr) + offset);
      if (direct) return direct;
    }
    return '';
  }

  readFramePosition(frameAddr) {
    const base = this.offsets.FramePositionX || 0;
    return {
      X: this.readFloat(Number(frameAddr) + base + 0x0),
      XOffset: this.readInt(Number(frameAddr) + base + 0x4)
    };
  }

  readFrameSize(frameAddr) {
    const base = this.offsets.FrameSizeX || 0;
    return {
      X: this.readFloat(Number(frameAddr) + base + 0x0),
      XOffset: this.readInt(Number(frameAddr) + base + 0x4),
      Y: this.readFloat(Number(frameAddr) + base + 0x8)
    };
  }

  readGuiVector2(instanceAddr, offsetKey) {
    const offset = this.offsets[offsetKey];
    if (!instanceAddr || offset == null) return null;
    const base = Number(instanceAddr) + offset;
    return {
      X: this.readFloat(base),
      Y: this.readFloat(base + 4)
    };
  }

  readFrameRotation(frameAddr) {
    const offset = this.offsets.FrameRotation;
    if (!frameAddr || offset == null) return null;
    return this.readFloat(Number(frameAddr) + offset);
  }

  readGuiObjectVisible(instanceAddr) {
    if (!instanceAddr) return false;
    const className = this.readClassName(instanceAddr);
    if (className === 'TextLabel' && this.offsets.TextLabelVisible != null) {
      return !!this.readByte(Number(instanceAddr) + this.offsets.TextLabelVisible);
    }
    if (this.offsets.FrameVisible != null) {
      return !!this.readByte(Number(instanceAddr) + this.offsets.FrameVisible);
    }
    return true;
  }

  readNotePosition(frameAddr) {
    const base = this.offsets.FramePositionX || 0;
    const addr = Number(frameAddr) + base;
    return {
      sx: this.readFloat(addr + 0x0),
      ox: this.readInt(addr + 0x4),
      sy: this.readFloat(addr + 0x8),
      oy: this.readInt(addr + 0xc)
    };
  }

  isCachedAddrValid(addr, expectedName) {
    if (!addr) return false;
    try {
      return this.readInstanceName(addr) === expectedName;
    } catch {
      return false;
    }
  }
}

module.exports = {
  MemorySession,
  isValidUserPointer
};
