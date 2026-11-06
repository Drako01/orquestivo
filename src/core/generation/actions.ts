/** Verified, SHA-pinned actions. Never add an entry here unless the SHA is known to be real. */
export const PINNED_ACTIONS = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', // v7
  setupNode: 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38', // v6
  setupGo: 'actions/setup-go@924ae3a1cded613372ab5595356fb5720e22ba16', // v6
  setupPython: 'actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1', // v6
  setupJava: 'actions/setup-java@b843ebf9b913146b38da2eaa7aeddf76074ae1ad', // v6
} as const;
