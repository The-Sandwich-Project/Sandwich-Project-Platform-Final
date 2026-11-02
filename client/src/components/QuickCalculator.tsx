import { useState, useCallback, useEffect } from 'react';
import { Calculator, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Operator = '+' | '-' | '×' | '÷' | null;

export function QuickCalculator() {
  const [isOpen, setIsOpen] = useState(false);
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<Operator>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [memory, setMemory] = useState<number>(0);
  const [hasMemory, setHasMemory] = useState(false);

  const clear = useCallback(() => {
    setDisplay('0');
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  }, []);

  const inputDigit = useCallback((digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  }, [display, waitingForOperand]);

  const inputDecimal = useCallback(() => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
      return;
    }
    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  }, [display, waitingForOperand]);

  const toggleSign = useCallback(() => {
    const value = parseFloat(display);
    if (value !== 0) {
      setDisplay(String(-value));
    }
  }, [display]);

  const inputPercent = useCallback(() => {
    const value = parseFloat(display);
    setDisplay(String(value / 100));
  }, [display]);

  const calculate = useCallback((left: number, right: number, op: Operator): number => {
    switch (op) {
      case '+': return left + right;
      case '-': return left - right;
      case '×': return left * right;
      case '÷': return right !== 0 ? left / right : 0;
      default: return right;
    }
  }, []);

  const performOperation = useCallback((nextOperator: Operator) => {
    const inputValue = parseFloat(display);

    if (previousValue != null && operator && !waitingForOperand) {
      const result = calculate(previousValue, inputValue, operator);
      const resultStr = parseFloat(result.toFixed(10)).toString();
      setDisplay(resultStr);
      setPreviousValue(result);
    } else {
      setPreviousValue(inputValue);
    }

    setWaitingForOperand(true);
    setOperator(nextOperator);
  }, [display, previousValue, operator, waitingForOperand, calculate]);

  const handleEquals = useCallback(() => {
    const inputValue = parseFloat(display);

    if (previousValue != null && operator) {
      const result = calculate(previousValue, inputValue, operator);
      const resultStr = parseFloat(result.toFixed(10)).toString();
      setDisplay(resultStr);
      setPreviousValue(null);
      setOperator(null);
      setWaitingForOperand(true);
    }
  }, [display, previousValue, operator, calculate]);

  const memoryAdd = useCallback(() => {
    setMemory(memory + parseFloat(display));
    setHasMemory(true);
    setWaitingForOperand(true);
  }, [display, memory]);

  const memoryRecall = useCallback(() => {
    if (hasMemory) {
      setDisplay(String(memory));
      setWaitingForOperand(true);
    }
  }, [memory, hasMemory]);

  const memoryClear = useCallback(() => {
    setMemory(0);
    setHasMemory(false);
  }, []);

  // Keyboard support
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        inputDigit(e.key);
      } else if (e.key === '.') {
        e.preventDefault();
        inputDecimal();
      } else if (e.key === '+') {
        e.preventDefault();
        performOperation('+');
      } else if (e.key === '-') {
        e.preventDefault();
        performOperation('-');
      } else if (e.key === '*') {
        e.preventDefault();
        performOperation('×');
      } else if (e.key === '/') {
        e.preventDefault();
        performOperation('÷');
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        handleEquals();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clear();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        if (!waitingForOperand && display.length > 1) {
          setDisplay(display.slice(0, -1));
        } else {
          setDisplay('0');
          setWaitingForOperand(false);
        }
      } else if (e.key === '%') {
        e.preventDefault();
        inputPercent();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, inputDigit, inputDecimal, performOperation, handleEquals, clear, inputPercent, display, waitingForOperand]);

  const btnBase = 'flex items-center justify-center rounded-lg font-semibold transition-all active:scale-95 select-none';
  const btnNum = `${btnBase} bg-white hover:bg-gray-50 text-gray-900 text-lg h-12 shadow-sm border border-gray-200`;
  const btnOp = `${btnBase} bg-[#236383] hover:bg-[#006570] text-white text-lg h-12 shadow-sm`;
  const btnFunc = `${btnBase} bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm h-12 border border-gray-200`;
  const btnEquals = `${btnBase} bg-[#FBAD3F] hover:bg-[#e99d2f] text-white text-xl h-12 shadow-sm font-bold`;

  // Format display for readability
  const formatDisplay = (val: string) => {
    if (val.includes('.')) return val;
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (Math.abs(num) >= 1e15) return num.toExponential(6);
    return num.toLocaleString('en-US');
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <button
              className="flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-2 rounded-md transition-colors text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white"
              aria-label="Calculator"
            >
              <Calculator className="w-4 h-4" />
              <span className="hidden lg:inline">Calculator</span>
            </button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>Quick Calculator</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-[320px] p-0 gap-0 rounded-2xl overflow-hidden border-0 shadow-2xl">
        <div className="bg-gradient-to-br from-[#236383] to-[#236383] p-4 pb-3">
          <DialogHeader className="mb-2">
            <DialogTitle className="flex items-center gap-2 text-white text-sm font-medium">
              <Calculator className="w-4 h-4" />
              Quick Calculator
            </DialogTitle>
          </DialogHeader>
          {/* Expression preview */}
          <div className="text-right text-white/50 text-xs h-4 font-mono">
            {previousValue != null && operator
              ? `${parseFloat(previousValue.toFixed(10)).toLocaleString('en-US')} ${operator}`
              : ''}
          </div>
          {/* Main display */}
          <div className="text-right text-white text-3xl font-bold font-mono tracking-tight min-h-[44px] overflow-hidden text-ellipsis whitespace-nowrap">
            {formatDisplay(display)}
          </div>
        </div>

        <div className="bg-gray-50 p-3 space-y-2">
          {/* Memory row */}
          <div className="grid grid-cols-4 gap-1.5">
            <button onClick={memoryClear} className={`${btnFunc} text-xs`}>MC</button>
            <button onClick={memoryRecall} className={`${btnFunc} text-xs ${hasMemory ? 'ring-1 ring-[#236383]' : ''}`}>MR</button>
            <button onClick={memoryAdd} className={`${btnFunc} text-xs`}>M+</button>
            <button onClick={clear} className={`${btnBase} bg-red-50 hover:bg-red-100 text-red-600 text-sm h-12 border border-red-200 font-bold`}>AC</button>
          </div>

          {/* Function row */}
          <div className="grid grid-cols-4 gap-1.5">
            <button onClick={toggleSign} className={btnFunc}>+/−</button>
            <button onClick={inputPercent} className={btnFunc}>%</button>
            <button onClick={() => {
              if (!waitingForOperand && display.length > 1) {
                setDisplay(display.slice(0, -1));
              } else {
                setDisplay('0');
                setWaitingForOperand(false);
              }
            }} className={btnFunc}>⌫</button>
            <button onClick={() => performOperation('÷')} className={`${btnOp} ${operator === '÷' && waitingForOperand ? 'ring-2 ring-white/50' : ''}`}>÷</button>
          </div>

          {/* Number grid */}
          <div className="grid grid-cols-4 gap-1.5">
            <button onClick={() => inputDigit('7')} className={btnNum}>7</button>
            <button onClick={() => inputDigit('8')} className={btnNum}>8</button>
            <button onClick={() => inputDigit('9')} className={btnNum}>9</button>
            <button onClick={() => performOperation('×')} className={`${btnOp} ${operator === '×' && waitingForOperand ? 'ring-2 ring-white/50' : ''}`}>×</button>

            <button onClick={() => inputDigit('4')} className={btnNum}>4</button>
            <button onClick={() => inputDigit('5')} className={btnNum}>5</button>
            <button onClick={() => inputDigit('6')} className={btnNum}>6</button>
            <button onClick={() => performOperation('-')} className={`${btnOp} ${operator === '-' && waitingForOperand ? 'ring-2 ring-white/50' : ''}`}>−</button>

            <button onClick={() => inputDigit('1')} className={btnNum}>1</button>
            <button onClick={() => inputDigit('2')} className={btnNum}>2</button>
            <button onClick={() => inputDigit('3')} className={btnNum}>3</button>
            <button onClick={() => performOperation('+')} className={`${btnOp} ${operator === '+' && waitingForOperand ? 'ring-2 ring-white/50' : ''}`}>+</button>

            <button onClick={() => inputDigit('0')} className={`${btnNum} col-span-2`}>0</button>
            <button onClick={inputDecimal} className={btnNum}>.</button>
            <button onClick={handleEquals} className={btnEquals}>=</button>
          </div>

          <p className="text-[10px] text-gray-400 text-center pt-1">Keyboard supported</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
