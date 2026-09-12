import {
	Euler,
	EventDispatcher,
	Vector3
} from 'three';

const _euler = new Euler( 0, 0, 0, 'YXZ' );
const _vector = new Vector3();

const _changeEvent = { type: 'change' };
const _lockEvent = { type: 'lock' };
const _unlockEvent = { type: 'unlock' };

const _PI_2 = Math.PI / 2;

class PointerLockControls extends EventDispatcher {

	constructor( camera, domElement ) {

		super();

		this.camera = camera;
		this.domElement = domElement;

		this.isLocked = false;

		this.minPolarAngle = 0;
		this.maxPolarAngle = Math.PI;

		this.pointerSpeed = 1.0;

		this._onMouseMove = onMouseMove.bind( this );
		this._onPointerlockChange = onPointerlockChange.bind( this );
		this._onPointerlockError = onPointerlockError.bind( this );

		this.connect();

	}

	connect() {

		this.domElement.ownerDocument.addEventListener( 'mousemove', this._onMouseMove );
		this.domElement.ownerDocument.addEventListener( 'pointerlockchange', this._onPointerlockChange );
		this.domElement.ownerDocument.addEventListener( 'pointerlockerror', this._onPointerlockError );

	}

	disconnect() {

		this.domElement.ownerDocument.removeEventListener( 'mousemove', this._onMouseMove );
		this.domElement.ownerDocument.removeEventListener( 'pointerlockchange', this._onPointerlockChange );
		this.domElement.ownerDocument.removeEventListener( 'pointerlockerror', this._onPointerlockError );

	}

	dispose() {

		this.disconnect();

	}

	getObject() {

		return this.camera;

	}

	getDirection( v ) {

		return v.set( 0, 0, - 1 ).applyQuaternion( this.camera.quaternion );

	}

	moveForward( distance ) {

		const camera = this.camera;

		_vector.setFromMatrixColumn( camera.matrix, 0 );

		_vector.crossVectors( camera.up, _vector );

		camera.position.addScaledVector( _vector, distance );

	}

	moveRight( distance ) {

		const camera = this.camera;

		_vector.setFromMatrixColumn( camera.matrix, 0 );

		camera.position.addScaledVector( _vector, distance );

	}

	// FIX: kiểm tra API trước khi gọi — iOS Safari không hỗ trợ Pointer Lock
	lock() {

		if ( typeof this.domElement.requestPointerLock === 'function' ) {

			this.domElement.requestPointerLock();

		}

	}

	// FIX: kiểm tra API trước khi gọi — tránh crash trên iOS Safari
	unlock() {

		const doc = this.domElement.ownerDocument;

		if ( doc && typeof doc.exitPointerLock === 'function' ) {

			doc.exitPointerLock();

		}

	}

}

function onMouseMove( event ) {

	if ( this.isLocked === false ) return;

	const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
	const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

	const camera = this.camera;
	_euler.setFromQuaternion( camera.quaternion );

	_euler.y -= movementX * 0.002 * this.pointerSpeed;
	_euler.x -= movementY * 0.002 * this.pointerSpeed;

	_euler.x = Math.max( _PI_2 - this.maxPolarAngle, Math.min( _PI_2 - this.minPolarAngle, _euler.x ) );

	camera.quaternion.setFromEuler( _euler );

	this.dispatchEvent( _changeEvent );

}

function onPointerlockChange() {

	const doc = this.domElement.ownerDocument;

	if ( ! doc ) return;

	if ( doc.pointerLockElement === this.domElement ) {

		this.dispatchEvent( _lockEvent );

		this.isLocked = true;

	} else {

		this.dispatchEvent( _unlockEvent );

		this.isLocked = false;

	}

}

function onPointerlockError() {

	console.error( 'THREE.PointerLockControls: Unable to use Pointer Lock API' );

}

export { PointerLockControls };
